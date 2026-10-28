import { searchX, socialSignals } from "./social";
import { chainSignals } from "./onchain";
import { writeVerdict, ruleScore } from "./verdict";
import { mockReport } from "./mock";
import type { CheckInput, PaidCall, Report } from "@/lib/types";

export const isMock = () => process.env.MOCK !== "0";

/** The full agent run for one check. */
export async function runCheck(input: CheckInput): Promise<Report> {
  if (isMock()) return mockReport(input);

  const receipts: PaidCall[] = [];
  const subject = [input.handle && `@${input.handle}`, input.contract && `${input.contract} on ${input.chain}`]
    .filter(Boolean)
    .join(" / ");

  // X and onchain reads run side by side
  const [social, chain] = await Promise.all([
    input.handle || input.contract
      ? (async () => {
          const q = input.handle ? `@${input.handle} within_time:7d` : `${input.contract} within_time:7d`;
          const latest = await searchX(q, "latest", receipts);
          const top = await searchX(q, "top", receipts);
          const map = new Map([...latest, ...top].map((p) => [p.id ?? p.text, p]));
          // the project's own posts are not traction
          const posts = [...map.values()].filter((p) => p.author !== input.handle?.toLowerCase());
          return socialSignals(posts);
        })().catch((e) => { console.error("x search failed", e); return null; })
      : Promise.resolve(null),
    input.contract
      ? chainSignals(input.chain, input.contract, receipts).catch((e) => { console.error("chain read failed", e); return null; })
      : Promise.resolve(null),
  ]);

  const verdict =
    social || chain
      ? await writeVerdict(subject, social, chain, receipts)
      : { ...ruleScore(null, null), label: "Not enough data" as const, summary: "No data came back for this project.", };

  return {
    input,
    social,
    chain,
    verdict: { score: verdict.score, label: verdict.label, summary: verdict.summary, flags: verdict.flags, positives: verdict.positives },
    paidCalls: receipts,
    mock: false,
    generatedAt: new Date().toISOString(),
  };
}
