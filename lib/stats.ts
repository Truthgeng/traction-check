
/**
 * Live usage, read straight from Celo mainnet (through the Blockscout explorer API), so
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

const BLOCKSCOUT = "https://celo.blockscout.com/api/v2";

/** Token transfers into or out of one address, newest first, back to launch */
async function transfers(address: string, direction: "from" | "to") {
  const out: (Payment & { time: number })[] = [];
  let next = "";
  for (let page = 0; page < 30; page++) {
    const res = await fetch(`${BLOCKSCOUT}/addresses/${address}/token-transfers?type=ERC-20&filter=${direction}${next}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Blockscout ${res.status}`);
    const json = await res.json();
    let older = false;
    for (const it of json.items ?? []) {
      const time = Date.parse(it.timestamp) / 1000;
      if (time < LAUNCH) { older = true; break; }
      const token = String(it.token?.address_hash ?? it.token?.address ?? "").toLowerCase();
      if (token !== USDT && token !== USDC) continue;
      out.push({
        from: String(it.from?.hash).toLowerCase(),
        to: String(it.to?.hash).toLowerCase(),
        usd: Number(it.total?.value ?? 0) / 10 ** Number(it.total?.decimals ?? 6),
        tx: it.transaction_hash,
        block: Number(it.block_number),
        time,
      });
    }
    if (older || !json.next_page_params) break;
    next = "&" + new URLSearchParams(Object.entries(json.next_page_params).map(([k, v]) => [k, String(v)])).toString();
  }
  return out;
}

let cache: { at: number; stats: Stats } | null = null;

export async function getStats(): Promise<Stats> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.stats;
  const payTo = (process.env.PAY_TO || "").toLowerCase();
  const [spent, received] = await Promise.all([
    transfers(AGENT, "from"),
    payTo ? transfers(payTo, "to") : Promise.resolve([]),
  ]);
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
