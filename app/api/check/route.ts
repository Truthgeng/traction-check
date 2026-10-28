import { NextRequest, NextResponse } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient, type RouteConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { runCheck, isMock } from "@/lib/agent/run";
import { CHAINS, type CheckInput } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseInput(body: any): CheckInput | string {
  const handle = typeof body?.handle === "string" ? body.handle.trim().replace(/^@/, "") : "";
  const contract = typeof body?.contract === "string" ? body.contract.trim() : "";
  const chain = CHAINS.some((c) => c.id === body?.chain) ? body.chain : "celo";
  if (!handle && !contract) return "Enter an X handle, a contract address, or both.";
  if (handle && !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return "That X handle doesn't look right.";
  if (contract && !/^0x[0-9a-fA-F]{40}$/.test(contract)) return "That contract address doesn't look right.";
  return { handle: handle || undefined, contract: (contract || undefined) as CheckInput["contract"], chain };
}

const handler = async (req: NextRequest): Promise<NextResponse<unknown>> => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const input = parseInput(body);
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });

  try {
    const report = await runCheck(input);
    return NextResponse.json(report);
  } catch (e) {
    console.error(e);
    // status >= 400 means withX402 does NOT settle the user's payment
    return NextResponse.json({ error: "The check failed. You were not charged." }, { status: 502 });
  }
};

// ---------------------------------------------------------------------------
// Users pay per check through Celo's hosted x402 facilitator.
// In mock mode, or before PAY_TO and X402_API_KEY are set, the route is free.
// ---------------------------------------------------------------------------

const CELO = "eip155:42220";
const USDC = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";

function paidHandler() {
  const payTo = process.env.PAY_TO as `0x${string}` | undefined;
  const apiKey = process.env.X402_API_KEY;
  if (isMock() || !payTo || !apiKey) return handler;

  const facilitator = new HTTPFacilitatorClient({
    url: "https://api.x402.celo.org",
    createAuthHeaders: async () => {
      const h = { "X-API-Key": apiKey };
      return { verify: h, settle: h, supported: h };
    },
  });
  const server = new x402ResourceServer(facilitator).register("eip155:*", new ExactEvmScheme());
  const amount = process.env.CHECK_PRICE_ATOMIC || "50000";

  const route: RouteConfig = {
    accepts: [
      { scheme: "exact", network: CELO, payTo, price: { amount, asset: USDT, extra: { name: "Tether USD", version: "1" } } },
      { scheme: "exact", network: CELO, payTo, price: { amount, asset: USDC, extra: { name: "USDC", version: "2" } } },
    ],
    description: "One traction check: X activity, onchain activity and a verdict",
  };
  return withX402(handler, route, server);
}

export const POST = paidHandler();
