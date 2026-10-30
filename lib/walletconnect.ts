"use client";

/**
 * WalletConnect for visitors with no wallet in their browser (plain Safari/Chrome,
 * the X in-app browser). Opens the "pick your wallet / scan QR" popup and returns an
 * EIP-1193 provider that behaves like window.ethereum.
 *
 * Loaded only when needed, so MiniPay and MetaMask users never download it.
 */
const CELO = 42220;
let cached: any = null;

export function walletConnectAvailable() {
  return !!process.env.NEXT_PUBLIC_WC_PROJECT_ID;
}

export async function connectWalletConnect() {
  const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
  if (!projectId) throw new Error("WalletConnect is not set up");
  if (!cached) {
    const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
    cached = await EthereumProvider.init({
      projectId,
      chains: [CELO],
      optionalChains: [CELO],
      showQrModal: true,
      methods: ["eth_requestAccounts", "eth_accounts", "eth_signTypedData_v4", "personal_sign", "wallet_switchEthereumChain"],
      rpcMap: { [CELO]: "https://forno.celo.org" },
      metadata: {
        name: "traction/check",
        description: "Is the hype real? Check any project's X traction.",
        url: typeof window !== "undefined" ? window.location.origin : "https://traction-check.vercel.app",
        icons: [`${typeof window !== "undefined" ? window.location.origin : "https://traction-check.vercel.app"}/icon.png`],
      },
    });
  }
  if (!cached.connected) await cached.connect();
  return cached;
}

export async function disconnectWalletConnect() {
  if (cached?.connected) await cached.disconnect().catch(() => {});
}
