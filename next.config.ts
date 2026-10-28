import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // buy-core and the x402 server packages run only on the server
  serverExternalPackages: ["@celo/buy-core"],
};

export default nextConfig;
