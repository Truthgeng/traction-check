import { NextRequest, NextResponse } from "next/server";
import { mode } from "@/lib/agent/mode";
import { COOKIE, FREE_CHECKS, freeLeft } from "@/lib/free";

export const dynamic = "force-dynamic";

/** Tells the page which mode it is in, what a check costs, and how many free checks are left. */
export async function GET(req: NextRequest) {
  const m = mode();
  const paid = m === "live" && !!process.env.PAY_TO && !!process.env.X402_API_KEY;
  const atomic = Number(process.env.CHECK_PRICE_ATOMIC || "50000");
  return NextResponse.json({
    mode: m,
    mock: m === "demo",
    paid,
    priceUsd: atomic / 1_000_000,
    freeChecks: FREE_CHECKS,
    freeLeft: paid ? freeLeft(req.cookies.get(COOKIE)?.value) : null,
  });
}
