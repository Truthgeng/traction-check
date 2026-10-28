import { NextResponse } from "next/server";

/** ERC-8004 registration file. Its URL is what the agent registers onchain. */
export async function GET() {
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  const agentId = process.env.AGENT_ID;

  return NextResponse.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "traction/check",
    description:
      "Checks whether a crypto project's traction is real or farmed. Pays buy services (X search, Chainstack Celo RPC, Cencori inference) per check and returns a scored verdict.",
    image: `${site}/icon.png`,
    services: [
      { name: "web", endpoint: site },
      { name: "check", endpoint: `${site}/api/check`, version: "1" },
    ],
    x402Support: true,
    active: true,
    supportedTrust: ["reputation"],
    registrations: agentId
      ? [{ agentId: Number(agentId), agentRegistry: "eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" }]
      : [],
  });
}
