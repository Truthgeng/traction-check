import { privateKeyToAccount } from "viem/accounts";
import { x402, getTokenBalance } from "@celo/buy-core";
import type { PaidCall } from "@/lib/types";
import { isSandbox } from "./mode";

export const GATEWAY = "https://gateway.usebuy.ai";

/** Converts a whole-token amount like "0.02" into 6-decimal atomic units. */
function toAtomic(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

let cached: { key: string; account: ReturnType<typeof privateKeyToAccount> } | null = null;
function agentAccount() {
  // Test mode uses its own key so a test wallet is never mixed up with the real one
  const name = isSandbox() ? "SANDBOX_PRIVATE_KEY" : "AGENT_PRIVATE_KEY";
  const key = process.env[name];
  if (!key) throw new Error(`${name} is not set`);
  if (cached?.key !== key) cached = { key, account: privateKeyToAccount(key as `0x${string}`) };
  return cached.account;
}

/**
 * Makes ONE paid request to a buy service.
 *
 * Rules this follows, taken from buy's own guidance:
 * - every call carries a hard spend cap (maxAmount)
 * - exactly one paid attempt, never an automatic retry, because a failed
 *   paid request may already have settled
 * - every payment is recorded with its tx hash, which is the proof we submit
 *
 * In test mode it pays with free test USDC on Celo Sepolia, and asks the
 * gateway's faucet for a top-up when the test wallet runs low.
 */
export async function paidPost(
  service: PaidCall["service"],
  path: string,
  body: unknown,
  maxWhole: string,
  receipts: PaidCall[],
): Promise<unknown> {
  const url = `${GATEWAY}${path}`;
  const sandbox = isSandbox();
  const network = sandbox ? "celo-sepolia" : "celo";

  const res = await x402.payingFetch(
    {
      account: agentAccount(),
      network,
      preferredToken: sandbox ? "USDC" : process.env.AGENT_PAY_TOKEN || "USDC",
      ...(sandbox
        ? {
            readBalance: getTokenBalance,
            topUp: async (info) => {
              const r = await x402.fundSandboxIfShort({ ...info, address: info.owner, read: getTokenBalance });
              return x402.sandboxFaucetNote(r);
            },
          }
        : {}),
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
          network,
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
