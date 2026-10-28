import { privateKeyToAccount } from "viem/accounts";
import { x402 } from "@celo/buy-core";
import type { PaidCall } from "@/lib/types";

export const GATEWAY = "https://gateway.usebuy.ai";

/** Converts a whole-token amount like "0.02" into 6-decimal atomic units. */
function toAtomic(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

let cachedAccount: ReturnType<typeof privateKeyToAccount> | null = null;
function agentAccount() {
  if (cachedAccount) return cachedAccount;
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new Error("AGENT_PRIVATE_KEY is not set");
  cachedAccount = privateKeyToAccount(key as `0x${string}`);
  return cachedAccount;
}

/**
 * Makes ONE paid request to a buy service.
 *
 * Rules this follows, taken from buy's own guidance:
 * - every call carries a hard spend cap (maxAmount)
 * - exactly one paid attempt, never an automatic retry, because a failed
 *   paid request may already have settled
 * - every payment is recorded with its tx hash, which is the proof we submit
 */
export async function paidPost(
  service: PaidCall["service"],
  path: string,
  body: unknown,
  maxWhole: string,
  receipts: PaidCall[],
): Promise<unknown> {
  const url = `${GATEWAY}${path}`;
  const res = await x402.payingFetch(
    {
      account: agentAccount(),
      network: "celo",
      preferredToken: process.env.AGENT_PAY_TOKEN || "USDC",
    },
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      maxAmount: toAtomic(maxWhole),
      maxRetries: 1,
      onPayment: (info) => {
        receipts.push({
          service,
          url,
          token: info.asset,
          amountAtomic: info.amount,
          txHash: info.txHash,
          outcome: info.outcome,
          at: info.timestamp,
        });
      },
    },
  );

  const text = await res.text();
  if (!res.ok) {
    // Do not retry. Report what came back so it can be checked by hand.
    throw new Error(`${service} returned ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
