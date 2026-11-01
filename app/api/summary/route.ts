import { NextRequest, NextResponse } from "next/server";
import { writeVerdict } from "@/lib/agent/verdict";
import { useSummaryToken } from "@/lib/summary-token";
import { updateCached } from "@/lib/cache";
import type { PaidCall } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Second step of a check: the agent pays Cencori (through buy) to write the
 * plain-language summary. Only accepted with the one-time token from /api/check,
 * for exactly the data that check returned.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { token, input, subject, social, chain } = body ?? {};
  if (typeof token !== "string" || !useSummaryToken(token, { input, subject, social, chain })) {
    return NextResponse.json({ error: "This summary link has expired. Run the check again." }, { status: 403 });
  }
  const receipts: PaidCall[] = [];
  const t0 = Date.now();
  const verdict = await writeVerdict(subject, social ?? null, chain ?? null, receipts);
  console.log("summary timing", JSON.stringify({ subject, ms: Date.now() - t0, paid: receipts.length }));
  updateCached(input, { verdict });
  return NextResponse.json({ verdict, paidCalls: receipts });
}
