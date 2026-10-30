import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseEventLogs, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { withAttribution } from "@celo/attribution-tags";
import { timingSafeEqual } from "node:crypto";
import { normaliseKey } from "@/lib/key";

/**
 * One-time ERC-8004 registration, run on the server so the agent key never leaves Vercel.
 * POST with header x-admin-secret: <ADMIN_SECRET>. Refuses if the agent is already registered.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"; // ERC-8004 Identity Registry, Celo mainnet
// Stablecoins the fee can be paid in (Celo fee abstraction). Source: docs.celo.org/tooling/contracts/fee-currencies
const FEE_TOKENS = [
  { symbol: "USDT", token: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", adapter: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72" },
  { symbol: "USDC", token: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", adapter: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B" },
] as const;

const abi = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ name: "agentId", type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "event", name: "Registered", inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "agentURI", type: "string", indexed: false },
    { name: "owner", type: "address", indexed: true },
  ] },
] as const;

function authorised(req: NextRequest) {
  const want = process.env.ADMIN_SECRET;
  // header preferred; ?key= also accepted so it can be triggered from a plain link
  const got = req.headers.get("x-admin-secret") ?? req.nextUrl.searchParams.get("key");
  if (!want || !got || want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** GET: shows what registration would use, without sending anything. With ?run=1 it registers. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return fail("Not allowed", 401);
  if (req.nextUrl.searchParams.get("run") === "1") return register(req);
  let key: `0x${string}` | undefined;
  try { key = normaliseKey(process.env.AGENT_PRIVATE_KEY); } catch (e) { return fail(String((e as Error).message)); }
  if (!key) return fail("AGENT_PRIVATE_KEY is not set");
  const account = privateKeyToAccount(key);
  const pc = createPublicClient({ chain: celo, transport: http() });
  const [balances, owned] = await Promise.all([
    readBalances(pc, account.address),
    pc.readContract({ address: REGISTRY, abi, functionName: "balanceOf", args: [account.address] }),
  ]);
  const site = (process.env.SITE_URL || req.nextUrl.origin).replace(/\/$/, "");
  return NextResponse.json({
    agentWallet: account.address,
    balances: Object.fromEntries(balances.map((b) => [b.symbol, Number(b.amount) / 1e6])),
    alreadyOwnsIdentities: Number(owned),
    agentURI: `${site}/agent.json`,
    attributionCode: process.env.ATTRIBUTION_CODE || null,
    agentIdSet: process.env.AGENT_ID || null,
  });
}

/** POST: registers. Exactly one attempt, never retried automatically. */
export async function POST(req: NextRequest) {
  if (!authorised(req)) return fail("Not allowed", 401);
  return register(req);
}

async function register(req: NextRequest) {
  if (process.env.AGENT_ID) return fail(`Already registered as agent ${process.env.AGENT_ID}`, 409);
  let key: `0x${string}` | undefined;
  try { key = normaliseKey(process.env.AGENT_PRIVATE_KEY); } catch (e) { return fail(String((e as Error).message)); }
  const code = process.env.ATTRIBUTION_CODE;
  if (!key) return fail("AGENT_PRIVATE_KEY is not set");
  if (!code) return fail("ATTRIBUTION_CODE is not set (it comes from your Loops House enrollment)");

  const account = privateKeyToAccount(key);
  const pc = createPublicClient({ chain: celo, transport: http() });

  // Never register twice: the registry is an NFT, so an existing identity shows up as a balance
  const owned = await pc.readContract({ address: REGISTRY, abi, functionName: "balanceOf", args: [account.address] });
  if (owned > 0n) return fail("This wallet already owns an ERC-8004 identity. Look it up on 8004scan.io before doing anything else.", 409);

  // Pay the fee in whichever stablecoin the wallet actually holds
  const balances = await readBalances(pc, account.address);
  const fee = balances.find((b) => b.amount >= 20_000n);
  if (!fee) return fail(`The agent wallet ${account.address} needs some USDT or USDC on Celo to pay the fee.`);

  const site = (process.env.SITE_URL || req.nextUrl.origin).replace(/\/$/, "");
  const agentURI = `${site}/agent.json`;
  const card = await fetch(agentURI).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!card?.services?.[0]?.endpoint) return fail(`${agentURI} is not serving a complete agent card`);

  const wallet = createWalletClient({ account, chain: celo, transport: http() }).extend(withAttribution(code));
  const { request } = await pc.simulateContract({ account, address: REGISTRY, abi, functionName: "register", args: [agentURI] });
  const hash = await wallet.writeContract({ ...request, feeCurrency: fee.adapter } as any);
  const receipt = await pc.waitForTransactionReceipt({ hash, timeout: 90_000 });
  const [event] = parseEventLogs({ abi, eventName: "Registered", logs: receipt.logs });

  return NextResponse.json({
    status: receipt.status,
    tx: hash,
    explorer: `https://celoscan.io/tx/${hash}`,
    agentId: event ? event.args.agentId.toString() : null,
    agentWallet: account.address,
    agentURI,
    feePaidIn: fee.symbol,
    next: event ? "Set AGENT_ID in Vercel to this agentId and redeploy." : "No Registered event found. Check the tx on celoscan before trying again.",
  });
}

// Celo chain types differ slightly from the generic client type, so take just the method we need
type BalanceReader = { readContract: (args: any) => Promise<unknown> };
async function readBalances(pc: BalanceReader, owner: `0x${string}`) {
  return Promise.all(
    FEE_TOKENS.map(async (t) => ({
      ...t,
      amount: (await pc.readContract({ address: t.token, abi: erc20Abi, functionName: "balanceOf", args: [owner] })) as bigint,
    })),
  );
}
