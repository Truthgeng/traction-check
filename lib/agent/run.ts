import { fetchProfile, searchXPages, socialSignals } from "./social";
import { chainSignals } from "./onchain";
import { writeVerdict, ruleVerdict } from "./verdict";
import { mockReport } from "./mock";
import { mode, isMock, isSandbox } from "./mode";
import type { CheckInput, PaidCall, Profile, Report } from "@/lib/types";
import { getCached, putCached } from "@/lib/cache";
import { makeSummaryToken } from "@/lib/summary-token";

export { isMock, isSandbox, mode };

/** An error the user should see as-is (and isn't charged for). */
export class CheckError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** The full agent run for one check. */
/**
 * summary "later" (the default) returns as soon as the data is in, with the rule
 * verdict, and a token the page uses to have the AI summary written next.
 * "inline" waits for the AI summary (used by the operator check).
 */
export async function runCheck(
  input: CheckInput,
  opts: { skipCache?: boolean; summary?: "later" | "inline" } = {},
): Promise<Report> {
  if (isMock()) return mockReport(input);
  const cached = opts.skipCache ? null : getCached(input);
  // A cached result never hands out another summary token, so it can't trigger a second paid summary
  if (cached) return { ...cached, summaryToken: undefined };
  const sandbox = isSandbox();
  const t0 = Date.now();
  const took: Record<string, number> = {};
  const lap = <T,>(name: string, p: Promise<T>) => p.finally(() => { took[name] = Date.now() - t0; });

  const receipts: PaidCall[] = [];
  const errors: string[] = [];
  const subject = [input.handle && `@${input.handle}`, input.contract && `${input.contract} on ${input.chain}`]
    .filter(Boolean)
    .join(" / ");

  const handle = input.handle?.toLowerCase();
  let postsFound = 0;
  let postsTagging = 0;

  // The profile lookup, the X searches and the onchain read all run side by side
  const [profile, social, chain] = await Promise.all([
    handle
      ? lap("profile", fetchProfile(handle, receipts)).catch((e) => { console.error("profile lookup failed", e); return undefined; })
      : Promise.resolve(undefined as Profile | null | undefined),
    (async () => {
      // Posts that tag the project, not posts by the project itself
      const q = handle ? `@${handle} -from:${handle} within_time:7d` : `${input.contract} within_time:7d`;
      // 1 page of latest + 1 page of top, side by side. buy settles one payment per wallet
      // about every 7 seconds, so every extra paid call adds that much to the wait.
      const [latest, top] = await Promise.all([
        lap("xLatest", searchXPages(q, "latest", 1, receipts)),
        lap("xTop", searchXPages(q, "top", 1, receipts)),
      ]);
      const found = [...new Map([...latest, ...top].map((p) => [p.id ?? p.text, p])).values()];
      postsFound = found.length;
      // X search matches loosely (usernames that contain the name, handles X adds to
      // replies). Only keep posts where the person actually tagged the project.
      const tagging = handle
        ? found.filter((p) => p.author !== handle && (p.bodyMentions ?? []).includes(handle))
        : found.filter((p) => p.text.toLowerCase().includes(input.contract!.toLowerCase()));
      postsTagging = tagging.length;
      return socialSignals(tagging);
    })().catch((e) => { console.error("x search failed", e); errors.push("x"); return null; }),
    input.contract
      ? lap("chain", chainSignals(input.chain, input.contract, receipts, { paidCelo: !sandbox }))
          .catch((e) => { console.error("chain read failed", e); errors.push("chain"); return null; })
      : Promise.resolve(null),
  ]);

  // X has no account with that handle: say so plainly instead of judging someone else's posts
  if (handle && profile === null && postsTagging === 0) {
    throw new CheckError(`Couldn't find @${input.handle} on X. Check the handle and try again.`, 404);
  }

  // Every source failed: report an error rather than a fake "not enough data" result.
  // The API turns this into a 502, so a paying user is not charged.
  if (!social && !chain && errors.length) {
    throw new Error(`All data sources failed (${errors.join(", ")})`);
  }

  // Cencori has no test network on buy, so test mode writes the summary from the rules alone
  const later = opts.summary !== "inline";
  const verdict = !social && !chain
    ? ruleVerdict(null, null)
    : sandbox || later
      ? ruleVerdict(social, chain)
      : await lap("verdict", writeVerdict(subject, social, chain, receipts));
  // The AI summary comes as a second step, so the result shows as soon as the data is in
  const summaryToken = later && !sandbox && (social || chain) ? makeSummaryToken({ input, subject, social, chain }) : undefined;
  // One line per check, so slow checks can be traced to the step that held them up
  console.log("check timing", JSON.stringify({ subject, ms: Date.now() - t0, steps: took, errors }));

  const report: Report = {
    input,
    profile: profile ?? null,
    postsFound,
    postsTagging,
    social,
    chain,
    verdict,
    paidCalls: receipts,
    summaryToken,
    mock: false,
    mode: mode(),
    generatedAt: new Date().toISOString(),
  };
  // Only cache a full result. A partial one (a source failed) should be retried next time.
  if (!errors.length) putCached(input, report);
  return report;
}
