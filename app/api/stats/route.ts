import { NextResponse } from "next/server";
import { getStats } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Live usage, read from Celo mainnet. Cached for 10 minutes. */
export async function GET() {
  try {
    return NextResponse.json(await getStats());
  } catch (e) {
    console.error("stats failed", e);
    return NextResponse.json({ error: "Couldn't read usage from Celo right now." }, { status: 503 });
  }
}
