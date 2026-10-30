"use client";

/**
 * Finds the wallets installed in this browser using EIP-6963. Each wallet extension
 * announces itself, so when several are installed (MetaMask plus Phantom, Rabby,
 * Coinbase...) we talk to the one the person picked, not whichever one grabbed
 * window.ethereum.
 */
export type InjectedWallet = { id: string; name: string; icon?: string; provider: any };

export function discoverWallets(onChange: (list: InjectedWallet[]) => void): () => void {
  const found = new Map<string, InjectedWallet>();
  const emit = () => onChange([...found.values()]);

  const onAnnounce = (e: any) => {
    const d = e?.detail;
    if (!d?.provider || !d?.info) return;
    const id = d.info.rdns || d.info.uuid || d.info.name;
    if (found.has(id)) return;
    found.set(id, { id, name: d.info.name || "Browser wallet", icon: d.info.icon, provider: d.provider });
    emit();
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // Older wallets (and MiniPay) only set window.ethereum. Use it if nothing announced.
  const fallback = setTimeout(() => {
    const e = (window as any).ethereum;
    if (found.size === 0 && e) {
      found.set("injected", { id: "injected", name: legacyName(e), provider: e });
      emit();
    }
  }, 400);

  return () => {
    clearTimeout(fallback);
    window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
  };
}

function legacyName(e: any): string {
  if (e.isMiniPay) return "MiniPay";
  if (e.isRabby) return "Rabby";
  if (e.isCoinbaseWallet) return "Coinbase Wallet";
  if (e.isBraveWallet) return "Brave Wallet";
  if (e.isTrust || e.isTrustWallet) return "Trust Wallet";
  if (e.isOkxWallet || e.isOKExWallet) return "OKX Wallet";
  if (e.isMetaMask) return "MetaMask";
  return "Browser wallet";
}
