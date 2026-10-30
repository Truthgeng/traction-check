import { NextRequest, NextResponse } from "next/server";

/** ERC-8004 registration file. Its URL is what the agent registers onchain. */
export async function GET(req: NextRequest) {
  // SITE_URL if set, otherwise the address this request came in on
  const site = (process.env.SITE_URL || req.nextUrl.origin).replace(/\/$/, "");
  const agentId = process.env.AGENT_ID;

  return NextResponse.json({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "traction/check",
    description:
      "Checks whether a crypto project's traction on X is real or farmed. For each check it pays buy services it does not own (X post search, X profile lookup, Chainstack Celo RPC, Cencori inference) and returns a scored verdict with links to every post it counted.",
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
