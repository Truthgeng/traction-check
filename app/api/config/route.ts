import { NextResponse } from "next/server";
import { isMock } from "@/lib/agent/run";

/** Tells the page whether checks cost money right now, and how much. */
export async function GET() {
  const paid = !isMock() && !!process.env.PAY_TO && !!process.env.X402_API_KEY;
  const atomic = Number(process.env.CHECK_PRICE_ATOMIC || "50000");
  return NextResponse.json({ mock: isMock(), paid, priceUsd: atomic / 1_000_000 });
}
