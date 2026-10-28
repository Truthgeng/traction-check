/**
 * Creates a fresh wallet for the agent and saves the key into .env.local.
 * Run on YOUR machine: npm run wallet
 * The key never leaves your computer. Do not paste it anywhere.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const file = ".env.local";
if (!existsSync(file)) copyFileSync(".env.example", file);
const env = readFileSync(file, "utf8");

const existing = env.match(/^AGENT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
if (existing) {
  console.log("Agent wallet already set up.");
  console.log("Address:", privateKeyToAccount(existing[1] as `0x${string}`).address);
  process.exit(0);
}

const key = generatePrivateKey();
const address = privateKeyToAccount(key).address;
writeFileSync(file, env.replace(/^AGENT_PRIVATE_KEY=.*$/m, `AGENT_PRIVATE_KEY=${key}`));

console.log("New agent wallet saved to .env.local");
console.log("Address:", address);
console.log("");
console.log("Next: send $5 to $10 of USDC on Celo mainnet to that address.");
console.log("Back up .env.local somewhere safe. If you lose it, the wallet and its ERC-8004 identity are gone.");
