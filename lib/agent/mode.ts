/**
 * Three modes:
 *   demo  MOCK=1 (default)          sample data, nothing paid
 *   test  MOCK=0 + SANDBOX=1        real X data, paid with free test USDC on Celo Sepolia
 *   live  MOCK=0 + SANDBOX=0        everything real, paid on Celo mainnet
 */
export type Mode = "demo" | "test" | "live";

export function mode(): Mode {
  if (process.env.MOCK !== "0") return "demo";
  return process.env.SANDBOX === "1" ? "test" : "live";
}

export const isMock = () => mode() === "demo";
export const isSandbox = () => mode() === "test";
