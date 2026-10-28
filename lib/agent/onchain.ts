import { paidPost, GATEWAY } from "./buy";
import type { Chain, ChainSignals, PaidCall } from "@/lib/types";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const WINDOW_HOURS = 48;
const MAX_TRANSFERS = 20_000; // stop reading after this many, enough to judge patterns

type Transfer = { from: string; to: string };

const topicToAddr = (t: string) => ("0x" + t.slice(-40)).toLowerCase();

// ---------------------------------------------------------------------------
// Celo: paid reads through Chainstack on the buy gateway ($0.01 per batch of up to 2000 calls)
// ---------------------------------------------------------------------------

const CELO_BLOCK_SECONDS = 1; // Celo L2 targets 1s blocks; checked against real timestamps below
const LOG_CHUNK = 5_000;

type RpcReply = { id: number; result?: any; error?: { message: string } };

async function rpcBatch(calls: { method: string; params: unknown[] }[], receipts: PaidCall[]) {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i + 1, ...c }));
  const raw = (await paidPost("chainstack", "/chainstack/celo", body, process.env.MAX_RPC || "0.02", receipts)) as
    | RpcReply[]
    | RpcReply;
  const list = Array.isArray(raw) ? raw : [raw];
  const byId = new Map(list.map((r) => [r.id, r]));
  return body.map((b) => byId.get(b.id));
}

async function celoTransfers(contract: string, receipts: PaidCall[]): Promise<Transfer[]> {
  // Batch 1: where is the chain head
  const [head] = await rpcBatch([{ method: "eth_blockNumber", params: [] }], receipts);
  if (!head?.result) throw new Error("Could not read Celo block number");
  const latest = Number(BigInt(head.result));
  const span = Math.floor((WINDOW_HOURS * 3600) / CELO_BLOCK_SECONDS);
  const start = Math.max(0, latest - span);

  // Batch 2: every Transfer log for the token across the window, in chunks
  const calls: { method: string; params: unknown[] }[] = [];
  for (let from = start; from <= latest; from += LOG_CHUNK) {
    const to = Math.min(latest, from + LOG_CHUNK - 1);
    calls.push({
      method: "eth_getLogs",
      params: [{ address: contract, topics: [TRANSFER_TOPIC], fromBlock: hex(from), toBlock: hex(to) }],
    });
  }
  const replies = await rpcBatch(calls, receipts);

  const transfers: Transfer[] = [];
  for (const r of replies) {
    if (!r?.result) continue; // a failed chunk is skipped, not retried
    for (const log of r.result as { topics: string[] }[]) {
      if (log.topics?.length >= 3) transfers.push({ from: topicToAddr(log.topics[1]), to: topicToAddr(log.topics[2]) });
      if (transfers.length >= MAX_TRANSFERS) return transfers;
    }
  }
  return transfers;
}

const hex = (n: number) => "0x" + n.toString(16);

// ---------------------------------------------------------------------------
// Other chains: SQD through the buy gateway (free, no payment)
// ---------------------------------------------------------------------------

const SQD_DATASET: Record<Chain, string> = {
  celo: "celo-mainnet",
  base: "base-mainnet",
  ethereum: "ethereum-mainnet",
  arbitrum: "arbitrum-one",
  bsc: "binance-mainnet",
};

/** SQD is free and unpaid, so retrying it is safe. Waits out its rate limit (Retry-After). */
async function sqdFetch(url: string, init?: RequestInit, tries = 4): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < tries; i++) {
    try {
      last = await fetch(url, init);
      if (last.ok || (last.status < 500 && last.status !== 429)) return last;
    } catch { /* network blip, try again */ }
    const wait = Number(last?.headers.get("retry-after")) || 1 + i * 2;
    await new Promise((res) => setTimeout(res, Math.min(wait, 8) * 1000));
  }
  if (last) return last;
  throw new Error(`SQD unreachable: ${url}`);
}

async function sqdTransfers(chain: Chain, contract: string): Promise<Transfer[]> {
  const ds = `${GATEWAY}/sqd/datasets/${SQD_DATASET[chain]}`;
  const since = Math.floor(Date.now() / 1000) - WINDOW_HOURS * 3600;

  const startRes = await sqdFetch(`${ds}/timestamps/${since}/block`);
  const headRes = await sqdFetch(`${ds}/head`);
  if (!startRes.ok || !headRes.ok) throw new Error(`SQD unavailable for ${chain} (${startRes.status}/${headRes.status})`);
  const fromBlock = Number((await startRes.json()).block_number);
  const head = await headRes.json();
  const toBlock = Number(head.number ?? head.block_number ?? head.height);

  const transfers: Transfer[] = [];
  let cursor = fromBlock;
  // stay well inside the 60s function limit: stop reading after 25s and judge what we have
  const deadline = Date.now() + 25_000;
  for (let page = 0; page < 40 && cursor <= toBlock && Date.now() < deadline; page++) {
    const res = await sqdFetch(`${ds}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "evm",
        fromBlock: cursor,
        toBlock,
        fields: { block: { number: true }, log: { topics: true } },
        logs: [{ address: [contract.toLowerCase()], topic0: [TRANSFER_TOPIC] }],
      }),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") || "2");
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) break;
    const lines = (await res.text()).split("\n").filter(Boolean);
    if (!lines.length) break;
    let last = cursor;
    for (const line of lines) {
      const blk = JSON.parse(line);
      last = Number(blk.header?.number ?? last);
      for (const log of blk.logs ?? []) {
        if (log.topics?.length >= 3) transfers.push({ from: topicToAddr(log.topics[1]), to: topicToAddr(log.topics[2]) });
      }
      if (transfers.length >= MAX_TRANSFERS) return transfers;
    }
    cursor = last + 1;
  }
  return transfers;
}

// ---------------------------------------------------------------------------

export async function chainSignals(
  chain: Chain,
  contract: string,
  receipts: PaidCall[],
  opts: { paidCelo: boolean } = { paidCelo: true },
): Promise<ChainSignals> {
  // Celo reads are paid through Chainstack in live mode. Chainstack has no test
  // network on buy, so test mode reads Celo through the free SQD route instead.
  const useChainstack = chain === "celo" && opts.paidCelo;
  const transfers = useChainstack ? await celoTransfers(contract, receipts) : await sqdTransfers(chain, contract);
  return summarise(chain, transfers, useChainstack ? "chainstack" : "sqd");
}

export function summarise(chain: Chain, transfers: Transfer[], source: ChainSignals["source"]): ChainSignals {
  const zero = "0x0000000000000000000000000000000000000000";
  const senders = new Set<string>();
  const receivers = new Set<string>();
  const touch = new Map<string, number>();
  const pairs = new Set<string>();

  for (const t of transfers) {
    if (t.from !== zero) senders.add(t.from);
    if (t.to !== zero) receivers.add(t.to);
    touch.set(t.from, (touch.get(t.from) ?? 0) + 1);
    touch.set(t.to, (touch.get(t.to) ?? 0) + 1);
    pairs.add(`${t.from}>${t.to}`);
  }
  touch.delete(zero);

  // Share of transfers that involve one of the 10 busiest wallets
  const top10 = new Set([...touch.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([a]) => a));
  const viaTop = transfers.filter((t) => top10.has(t.from) || top10.has(t.to)).length;

  // Wallets sending to each other both ways, a common wash pattern.
  // Pools, routers and exchanges trade both ways with everyone, so an address that
  // deals with a large number of DIFFERENT wallets is treated as a hub and left out.
  // A closed ring of bots only ever deals with its own few members, so it stays counted.
  const counterparties = new Map<string, Set<string>>();
  for (const t of transfers) {
    if (!counterparties.has(t.from)) counterparties.set(t.from, new Set());
    if (!counterparties.has(t.to)) counterparties.set(t.to, new Set());
    counterparties.get(t.from)!.add(t.to);
    counterparties.get(t.to)!.add(t.from);
  }
  const hubThreshold = Math.max(50, Math.floor(counterparties.size * 0.1));
  const hubs = new Set([...counterparties.entries()].filter(([, c]) => c.size >= hubThreshold).map(([a]) => a));
  let pingPong = 0;
  for (const p of pairs) {
    const [a, b] = p.split(">");
    if (a < b && !hubs.has(a) && !hubs.has(b) && pairs.has(`${b}>${a}`)) pingPong++;
  }

  return {
    chain,
    windowHours: WINDOW_HOURS,
    transfers: transfers.length,
    uniqueSenders: senders.size,
    uniqueReceivers: receivers.size,
    topWalletShare: transfers.length ? viaTop / transfers.length : 0,
    pingPongPairs: pingPong,
    source,
  };
}
