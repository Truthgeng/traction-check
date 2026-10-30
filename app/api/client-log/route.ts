import { NextRequest, NextResponse } from "next/server";

/**
 * Wallet errors happen in the visitor's browser, where the server can't see them.
 * The page posts a short description here so it shows up in the Vercel logs.
 * No addresses, keys or signatures are sent, only the error text and browser type.
 */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
    console.warn(b.message ? "client wallet error:" : "client wallet step:", JSON.stringify({
      step: clip(b.step, 40),
      message: clip(b.message, 400),
      wallet: clip(b.wallet, 60),
      ua: clip(req.headers.get("user-agent"), 200),
    }));
  } catch { /* ignore bad input */ }
  return new NextResponse(null, { status: 204 });
}
