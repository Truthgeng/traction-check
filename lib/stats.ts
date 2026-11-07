import { GATEWAY } from "@/lib/agent/buy";
import { SQD_DATASET, TRANSFER_TOPIC, sqdFetch, topicToAddr } from "@/lib/agent/onchain";

/**
 * Live usage, read straight from Celo mainnet (through buy's free SQD route), so
 * anyone can check it on Celoscan:
 *  - every payment the agent wallet made to buy services
 *  - every payment users made to the site (PayTo)
 */
const USDT = "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e";
const USDC = "0xceba9300f2b948710d2653dd7b07f33a8b32118c";
const AGENT = "0xe85c29f1461ec1f550b7981a23190ec57dd79a67";
const LAUNCH = Date.UTC(2026, 9, 29) / 1000; // Oct 29 2026, before the first live check

type Payment = { from: string; to: string; usd: number; tx: string; block: number };
export type Stats = {
  since: string;
  updatedAt: string;
  agent: { address: string; calls: number; usd: number; counterparties: number };
  users: { payTo: string; payments: number; usd: number; payers: number; recent: { from: string; tx: string }[] };
  byDay: { day: string; agentCalls: number; userPayments: number }[];
};

const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

async function logs(ds: string, filter: Record<string, unknown>, fromBlock: number, toBlock: number) {
  const out: (Payment & { time: number })[] = [];
  let cursor = fromBlock;
  const deadline = Date.now() + 25_000;
  let busy = 0;
  while (cursor <= toBlock && Date.now() < deadline) {
    const res = await sqdFetch(`${ds}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "evm",
        fromBlock: cursor,
        toBlock,
        fields: { block: { number: true, timestamp: true }, log: { topics: true, data: true, transactionHash: true } },
        logs: [{ address: [USDT, USDC], topic0: [TRANSFER_TOPIC], ...filter }],
      }),
    });
    if (res.status === 529 || res.status === 503 || res.status === 429) {
      // SQD is busy: wait and try the same range again
      if (++busy > 6) throw new Error(`SQD busy (${res.status})`);
      await new Promise((r) => setTimeout(r, 1500 * busy));
      continue;
    }
    if (!res.ok) throw new Error(`SQD ${res.status}`);
    const lines = (await res.text()).split("\n").filter(Boolean);
    if (!lines.length) break;
    let last = cursor;
    for (const line of lines) {
      const blk = JSON.parse(line);
      last = Number(blk.header?.number ?? last);
      for (const l of blk.logs ?? []) {
        out.push({
          from: topicToAddr(l.topics[1]),
          to: topicToAddr(l.topics[2]),
          usd: Number(BigInt(l.data)) / 1e6, // USDT and USDC both have 6 decimals
          tx: l.transactionHash,
          block: last,
          time: Number(blk.header?.timestamp ?? 0),
        });
      }
    }
    if (last < cursor) break;
    cursor = last + 1;
  }
  return out;
}

let cache: { at: number; stats: Stats } | null = null;

export async function getStats(): Promise<Stats> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.stats;
  const payTo = (process.env.PAY_TO || "").toLowerCase();
  const ds = `${GATEWAY}/sqd/datasets/${SQD_DATASET.celo}`;
  const [startRes, headRes] = await Promise.all([sqdFetch(`${ds}/timestamps/${LAUNCH}/block`), sqdFetch(`${ds}/head`)]);
  const start = Number((await startRes.json()).block_number ?? 0);
  const head = Number((await headRes.json()).number);

  // One after the other: SQD rejects parallel heavy streams
  const spent = await logs(ds, { topic1: [pad(AGENT)] }, start, head);
  const received = payTo ? await logs(ds, { topic2: [pad(payTo)] }, start, head) : [];
  // The agent's own float top-ups are not purchases; buy payments are small per-call amounts
  const calls = spent.filter((p) => p.usd > 0 && p.usd <= 0.05 && p.to !== "0x0000000000000000000000000000000000000000");
  const userPays = received.filter((p) => p.from !== AGENT);

  const days = new Map<string, { agentCalls: number; userPayments: number }>();
  const dayOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  for (const p of calls) { const d = days.get(dayOf(p.time)) ?? { agentCalls: 0, userPayments: 0 }; d.agentCalls++; days.set(dayOf(p.time), d); }
  for (const p of userPays) { const d = days.get(dayOf(p.time)) ?? { agentCalls: 0, userPayments: 0 }; d.userPayments++; days.set(dayOf(p.time), d); }

  const stats: Stats = {
    since: new Date(LAUNCH * 1000).toISOString().slice(0, 10),
    updatedAt: new Date().toISOString(),
    agent: {
      address: AGENT,
      calls: calls.length,
      usd: Math.round(calls.reduce((s, p) => s + p.usd, 0) * 1000) / 1000,
      counterparties: new Set(calls.map((p) => p.to)).size,
    },
    users: {
      payTo,
      payments: userPays.length,
      usd: Math.round(userPays.reduce((s, p) => s + p.usd, 0) * 100) / 100,
      payers: new Set(userPays.map((p) => p.from)).size,
      recent: userPays.slice(-10).reverse().map((p) => ({ from: p.from, tx: p.tx })),
    },
    byDay: [...days.entries()].sort().map(([day, v]) => ({ day, ...v })),
  };
  cache = { at: Date.now(), stats };
  return stats;
}
