/**
 * Registers the agent's ERC-8004 identity on Celo mainnet, from the agent wallet.
 * Required for every track. Run once, after the site is deployed and the wallet is funded:
 *   npm run register
 *
 * Needs in .env.local: AGENT_PRIVATE_KEY, SITE_URL, ATTRIBUTION_CODE
 * Gas is paid in USDC through Celo fee abstraction, so no CELO is needed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { withAttribution } from "@celo/attribution-tags";

// load .env.local without extra packages
const envText = readFileSync(".env.local", "utf8");
const env = Object.fromEntries(
  envText.split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"; // ERC-8004 Identity Registry, Celo mainnet
const USDC_FEE_ADAPTER = "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B"; // pay gas in USDC

const abi = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ name: "agentId", type: "uint256" }] },
  { type: "event", name: "Registered", inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
  ] },
] as const;

function need(name: string) {
  const v = env[name];
  if (!v) { console.error(`Set ${name} in .env.local first.`); process.exit(1); }
  return v;
}

const rawKey = need("AGENT_PRIVATE_KEY").replace(/^0x/i, "");
const key = `0x${rawKey}` as `0x${string}`;
const site = need("SITE_URL").replace(/\/$/, "");
const code = need("ATTRIBUTION_CODE");
if (env.AGENT_ID) { console.log(`Already registered as agent ${env.AGENT_ID}.`); process.exit(0); }

const agentURI = `${site}/agent.json`;
const res = await fetch(agentURI).catch(() => null);
if (!res?.ok) { console.error(`${agentURI} is not reachable. Deploy the site first.`); process.exit(1); }

const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain: celo, transport: http() });
const wallet = createWalletClient({ account, chain: celo, transport: http() }).extend(withAttribution(code));

console.log(`Registering ${account.address} with ${agentURI} ...`);
const { request } = await publicClient.simulateContract({ account, address: REGISTRY, abi, functionName: "register", args: [agentURI] });
const hash = await wallet.writeContract({ ...request, feeCurrency: USDC_FEE_ADAPTER } as any);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const [event] = parseEventLogs({ abi, eventName: "Registered", logs: receipt.logs });
if (!event) { console.error(`No Registered event in ${hash}. Check it on celoscan before trying again.`); process.exit(1); }

const agentId = event.args.agentId.toString();
writeFileSync(".env.local", envText.trimEnd() + `\nAGENT_ID=${agentId}\n`);
console.log(`Done. Agent ID ${agentId}`);
console.log(`Tx: https://celoscan.io/tx/${hash}`);
console.log(`Add AGENT_ID=${agentId} to your Vercel environment variables and redeploy, so agent.json lists the registration.`);
