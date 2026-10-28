import { NextResponse } from "next/server";
import { mode } from "@/lib/agent/mode";

/** Tells the page which mode it is in and what a check costs. */
export async function GET() {
  const m = mode();
  const paid = m === "live" && !!process.env.PAY_TO && !!process.env.X402_API_KEY;
  const atomic = Number(process.env.CHECK_PRICE_ATOMIC || "50000");
  return NextResponse.json({ mode: m, mock: m === "demo", paid, priceUsd: atomic / 1_000_000 });
}
