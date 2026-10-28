import { socialSignals } from "./social";
import { summarise } from "./onchain";
import { ruleScore } from "./verdict";
import type { CheckInput, PaidCall, Post, Report } from "@/lib/types";

/**
 * Mock mode: fake posts and transfers pushed through the REAL scoring code,
 * so the page and the logic can be tested before the wallet is funded.
 * Same input always gives the same result.
 */
export function mockReport(input: CheckInput): Report {
  const seed = hash(`${input.handle ?? ""}${input.contract ?? ""}`);
  const rand = rng(seed);
  const farmed = seed % 2 === 0;

  // ---- fake X posts
  const posts: Post[] = [];
  const shill = ["huge alpha dont miss this", "this project is going to 100x lfg", "early gem, aping now"];
  const real = [
    "tried the testnet, swaps were fast but the bridge UI is confusing",
    "their docs on the vault design are actually solid",
    "not sure about the tokenomics yet, waiting for the audit",
    "used it for a payout today, fees were basically zero",
    "the team answered my question in discord within minutes",
  ];
  const count = 30 + Math.floor(rand() * 20);
  for (let i = 0; i < count; i++) {
    if (farmed) {
      const a = `bot_${Math.floor(rand() * 8)}`;
      posts.push({ id: `m${i}`, author: a, followers: Math.floor(rand() * 150), text: shill[Math.floor(rand() * shill.length)], likes: 0, reposts: rand() > 0.8 ? 1 : 0 });
    } else {
      const a = `user_${Math.floor(rand() * 60)}`;
      // real people word things differently, so mix an opener with a topic
      const openers = ["honestly", "ok so", "update:", "small thing but", "day 3 using it and", "fwiw", "not gonna lie", "quick take,"];
      const text = `${openers[Math.floor(rand() * openers.length)]} ${real[Math.floor(rand() * real.length)]}, ${["will keep testing", "curious what others think", "still early", "worth a look", "need more data"][Math.floor(rand() * 5)]}`;
      posts.push({ id: `m${i}`, author: a, followers: 200 + Math.floor(rand() * 9000), text, likes: Math.floor(rand() * 40), reposts: Math.floor(rand() * 8) });
    }
  }
  const social = input.handle || input.contract ? socialSignals(posts) : null;

  // ---- fake transfers
  let chain = null;
  if (input.contract) {
    const wallets = Array.from({ length: farmed ? 12 : 400 }, (_, i) => `0x${(seed + i).toString(16).padStart(40, "0")}`);
    const transfers = [];
    const n = farmed ? 600 : 1500;
    for (let i = 0; i < n; i++) {
      const from = wallets[Math.floor(rand() * wallets.length)];
      const to = wallets[Math.floor(rand() * wallets.length)];
      if (from !== to) transfers.push({ from, to });
    }
    chain = summarise(input.chain, transfers, "mock");
  }

  const base = ruleScore(social, chain);
  const label = base.score >= 65 ? "Looks organic" : base.score >= 40 ? "Mixed signals" : "Looks farmed";
  const now = new Date().toISOString();
  const paidCalls: PaidCall[] = [
    { service: "x-search", url: "mock", token: "USDC", amountAtomic: "5000", outcome: "mock", at: now },
    { service: "x-search", url: "mock", token: "USDC", amountAtomic: "5000", outcome: "mock", at: now },
    ...(input.contract && input.chain === "celo"
      ? ([
          { service: "chainstack", url: "mock", token: "USDC", amountAtomic: "10000", outcome: "mock", at: now },
          { service: "chainstack", url: "mock", token: "USDC", amountAtomic: "10000", outcome: "mock", at: now },
        ] as PaidCall[])
      : []),
    { service: "cencori", url: "mock", token: "USDC", amountAtomic: "10000", outcome: "mock", at: now },
  ];

  return {
    input,
    social,
    chain,
    verdict: {
      score: base.score,
      label: base.evidence ? label : "Not enough data",
      summary: farmed
        ? `Most of the noise comes from a small group of low-follower accounts repeating the same lines${chain ? ", and the token mostly moves between a handful of wallets" : ""}.`
        : `Mentions come from different accounts talking about actual use${chain ? ", and the token is moving between a wide spread of wallets" : ""}. ${label === "Looks organic" ? "" : "Not enough to call it clearly organic yet."}`.trim(),
      flags: base.flags,
      positives: base.positives,
    },
    paidCalls,
    mock: true,
    mode: "demo",
    generatedAt: now,
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  // mulberry32
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
