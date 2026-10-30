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
let loading: Promise<typeof import("@walletconnect/ethereum-provider")> | null = null;

/** Starts downloading WalletConnect in the background, so Connect is quick when tapped */
export function preloadWalletConnect() {
  if (!process.env.NEXT_PUBLIC_WC_PROJECT_ID) return;
  if (!loading) {
    loading = import("@walletconnect/ethereum-provider");
    loading.catch(() => { loading = null; }); // let a later tap try again
  }
  return loading;
}

export function walletConnectAvailable() {
  return !!process.env.NEXT_PUBLIC_WC_PROJECT_ID;
}

type Step = (step: string, detail?: string) => void;

/**
 * Connects through WalletConnect. Reports each stage through `step`, and fails with a
 * clear error if the popup never gets as far as showing a QR code / wallet list.
 */
export async function connectWalletConnect(step: Step = () => {}) {
  const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;
  if (!projectId) throw new Error("WalletConnect is not set up");

  if (!cached) {
    step("wc-load");
    const { EthereumProvider } = await withTimeout(preloadWalletConnect()!, 45_000, "Loading WalletConnect");
    step("wc-init");
    const origin = window.location.origin;
    cached = await withTimeout(
      EthereumProvider.init({
        projectId,
        chains: [CELO],
        optionalChains: [CELO],
        showQrModal: true,
        methods: ["eth_requestAccounts", "eth_accounts", "eth_signTypedData_v4", "personal_sign", "wallet_switchEthereumChain"],
        rpcMap: { [CELO]: "https://forno.celo.org" },
        metadata: {
          name: "traction/check",
          description: "Is the hype real? Check any project's X traction.",
          url: origin,
          icons: [`${origin}/icon.png`],
        },
      }),
      30_000,
      "Starting WalletConnect",
    );
  }
  if (cached.connected) return cached;

  step("wc-open");
  // The popup is ready once WalletConnect hands it a pairing link. If that never
  // happens, the popup isn't showing, so stop waiting and say so.
  let shown = false;
  const onUri = () => { shown = true; step("wc-shown"); };
  cached.on?.("display_uri", onUri);
  try {
    const connecting = cached.connect();
    await Promise.race([
      connecting,
      new Promise((_, rej) =>
        setTimeout(() => {
          if (!shown) rej(new Error("WalletConnect popup didn't open"));
        }, 20_000),
      ),
    ]);
    // Popup showed: now wait (longer) for the person to approve in their wallet app
    await withTimeout(connecting, 180_000, "Wallet");
  } finally {
    cached.removeListener?.("display_uri", onUri);
  }
  step("wc-connected");
  return cached;
}

export async function disconnectWalletConnect() {
  if (cached?.connected) await cached.disconnect().catch(() => {});
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} didn't respond`)), ms))]);
}
