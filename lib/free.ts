import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Free checks before a visitor has to pay.
 *
 * The count lives in a signed cookie, so it can't be edited to get more.
 * Someone can still clear cookies to reset it. That's accepted: each free
 * check costs the agent about $0.03, and the agent wallet is a small float,
 * so the worst case is bounded by what's in it. FREE_DAILY_LIMIT adds a
 * per-server-instance ceiling on top.
 */

export const FREE_CHECKS = Number(process.env.FREE_CHECKS ?? "2");
const DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT ?? "300");
export const COOKIE = "tc_free";

function secret() {
  // Any stable server-only value works. FREE_CHECK_SECRET is preferred.
  return process.env.FREE_CHECK_SECRET || process.env.X402_API_KEY || process.env.AGENT_PRIVATE_KEY || "dev-only-secret";
}

const sign = (n: number) => createHmac("sha256", secret()).update(`free:${n}`).digest("base64url").slice(0, 22);

/** How many free checks this visitor has used. A missing or tampered cookie counts as 0 used. */
export function usedFree(cookieValue: string | undefined): number {
  if (!cookieValue) return 0;
  const [n, sig] = cookieValue.split(".");
  const count = Number(n);
  if (!Number.isInteger(count) || count < 0 || !sig) return 0;
  const expected = sign(count);
  const ok = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  // A forged cookie gets no free checks at all, rather than a fresh allowance
  return ok ? count : FREE_CHECKS;
}

export const freeLeft = (cookieValue: string | undefined) => Math.max(0, FREE_CHECKS - usedFree(cookieValue));

export function nextCookie(cookieValue: string | undefined) {
  const n = usedFree(cookieValue) + 1;
  return `${n}.${sign(n)}`;
}

// Soft daily ceiling per server instance, so a viral spike can't drain the wallet in an hour
let day = "";
let usedToday = 0;
export function takeDailySlot(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; usedToday = 0; }
  if (usedToday >= DAILY_LIMIT) return false;
  usedToday++;
  return true;
}
