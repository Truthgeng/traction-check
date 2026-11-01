import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The AI summary is a paid call the agent makes, so only a page that just got a
 * real check result may ask for it, once, within a few minutes. The token signs
 * exactly the data the summary will be written from.
 */
const TTL_MS = 10 * 60 * 1000;
const used = new Set<string>();

function secret() {
  return process.env.FREE_CHECK_SECRET || process.env.ADMIN_SECRET || process.env.X402_API_KEY || "dev-only-secret";
}
const digest = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("base64url");
const mac = (body: string) => createHmac("sha256", secret()).update(`summary:${body}`).digest("base64url");

export function makeSummaryToken(data: unknown): string {
  const body = `${Date.now() + TTL_MS}.${digest(data)}`;
  return `${body}.${mac(body)}`;
}

/** True once per token, for the exact data it was issued for */
export function useSummaryToken(token: string, data: unknown): boolean {
  const [exp, dig, sig] = token.split(".");
  if (!exp || !dig || !sig) return false;
  const body = `${exp}.${dig}`;
  const want = mac(body);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  if (Number(exp) < Date.now() || dig !== digest(data) || used.has(sig)) return false;
  used.add(sig);
  if (used.size > 5000) used.delete(used.values().next().value!);
  return true;
}
