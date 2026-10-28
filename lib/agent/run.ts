import { searchX, socialSignals } from "./social";
import { chainSignals } from "./onchain";
import { writeVerdict, ruleVerdict } from "./verdict";
import { mockReport } from "./mock";
import { mode, isMock, isSandbox } from "./mode";
import type { CheckInput, PaidCall, Report } from "@/lib/types";

export { isMock, isSandbox, mode };

/** The full agent run for one check. */
export async function runCheck(input: CheckInput): Promise<Report> {
  if (isMock()) return mockReport(input);
  const sandbox = isSandbox();

  const receipts: PaidCall[] = [];
  const errors: string[] = [];
  const subject = [input.handle && `@${input.handle}`, input.contract && `${input.contract} on ${input.chain}`]
    .filter(Boolean)
    .join(" / ");

  // X and onchain reads run side by side
  const [social, chain] = await Promise.all([
    (async () => {
      const q = input.handle ? `@${input.handle} within_time:7d` : `${input.contract} within_time:7d`;
      const latest = await searchX(q, "latest", receipts);
      const top = await searchX(q, "top", receipts);
      const map = new Map([...latest, ...top].map((p) => [p.id ?? p.text, p]));
      // the project's own posts are not traction
      const posts = [...map.values()].filter((p) => p.author !== input.handle?.toLowerCase());
      return socialSignals(posts);
    })().catch((e) => { console.error("x search failed", e); errors.push("x"); return null; }),
    input.contract
      ? chainSignals(input.chain, input.contract, receipts, { paidCelo: !sandbox })
          .catch((e) => { console.error("chain read failed", e); errors.push("chain"); return null; })
      : Promise.resolve(null),
  ]);

  // Every source failed: report an error rather than a fake "not enough data" result.
  // The API turns this into a 502, so a paying user is not charged.
  if (!social && !chain && errors.length) {
    throw new Error(`All data sources failed (${errors.join(", ")})`);
  }

  // Cencori has no test network on buy, so test mode writes the summary from the rules alone
  const verdict = !social && !chain
    ? ruleVerdict(null, null)
    : sandbox
      ? ruleVerdict(social, chain)
      : await writeVerdict(subject, social, chain, receipts);

  return {
    input,
    social,
    chain,
    verdict,
    paidCalls: receipts,
    mock: false,
    mode: mode(),
    generatedAt: new Date().toISOString(),
  };
}
