import { NextRequest, NextResponse } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient, type RouteConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { runCheck, CheckError } from "@/lib/agent/run";
import { isMock, isSandbox } from "@/lib/agent/mode";
import { CHAINS, type CheckInput } from "@/lib/types";
import { COOKIE, freeLeft, nextCookie, takeDailySlot } from "@/lib/free";

export const runtime = "nodejs";
// Checks usually take 30 to 45s (several paid calls plus chain reads). 120s gives headroom.
export const maxDuration = 120;

function parseInput(body: any): CheckInput | string {
  // Accept "@name", "name", or a pasted profile link like https://x.com/name/status/123
  let handle = typeof body?.handle === "string" ? body.handle.trim() : "";
  const link = handle.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})/i);
  handle = (link ? link[1] : handle).replace(/^@/, "");
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
    // Test mode only: x-no-cache lets us measure how steady fresh results are
    const skipCache = isSandbox() && req.headers.get("x-no-cache") === "1";
    const report = await runCheck(input, { skipCache });
    return NextResponse.json(report);
  } catch (e) {
    if (e instanceof CheckError) return NextResponse.json({ error: e.message }, { status: e.status });
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
  if (isMock() || isSandbox() || !payTo || !apiKey) return handler;

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

const paid = paidHandler();
const paymentOn = paid !== handler;

/**
 * Each visitor gets FREE_CHECKS free checks (default 2), then pays per check.
 * A request that already carries a payment always goes down the paid path.
 */
export async function POST(req: NextRequest) {
  const hasPayment = req.headers.has("x-payment") || req.headers.has("payment-signature");
  const cookie = req.cookies.get(COOKIE)?.value;

  if (!paymentOn || hasPayment || freeLeft(cookie) === 0) {
    try {
      const res = await paid(req);
      // The x402 wrapper answers 500 when it can't reach the payment facilitator.
      // Our own handler never returns 500 (it uses 502), so this is the payment step.
      if (res.status === 500) {
        return NextResponse.json({ error: "Payments are unavailable right now. Try again in a minute." }, { status: 503 });
      }
      return res;
    } catch (e) {
      console.error("payment step failed", e);
      return NextResponse.json({ error: "Payments are unavailable right now. Try again in a minute." }, { status: 503 });
    }
  }

  if (!takeDailySlot()) {
    return NextResponse.json(
      { error: "Free checks are used up for today. Connect a wallet to keep going.", needsPayment: true },
      { status: 429 },
    );
  }

  const res = await handler(req);
  // Only a check that actually worked uses up a free one
  if (res.ok) {
    res.cookies.set(COOKIE, nextCookie(cookie), {
      httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
