"use client";

import { useEffect, useState } from "react";
import { createWalletClient, custom, type WalletClient } from "viem";
import { celo } from "viem/chains";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { CHAINS, type AccountTier, type Chain, type Report } from "@/lib/types";
import { connectWalletConnect, disconnectWalletConnect, preloadWalletConnect, walletConnectAvailable } from "@/lib/walletconnect";
import { discoverWallets, type InjectedWallet } from "@/lib/wallets";

/** Sends a wallet error to the server logs so it can be diagnosed. Never blocks the page. */
function reportWalletError(step: string, err: unknown, wallet: string) {
  try {
    const message = err instanceof Error ? err.message : String(err);
    fetch("/api/client-log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step, message, wallet }) });
  } catch { /* ignore */ }
}

/** Logs a connection stage, so a silent failure shows where it stopped */
function reportWalletStep(step: string, wallet: string) {
  try {
    fetch("/api/client-log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ step, message: "", wallet }) });
  } catch { /* ignore */ }
}

/** Rejects if the wallet hasn't answered in time, so the page never just sits there */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} didn't respond`)), ms))]);
}

/** Turns wallet errors into something a person can act on */
function walletMessage(err: unknown): string {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (m.includes("reject") || m.includes("denied") || m.includes("cancel") || m.includes("closed modal") || m.includes("user closed"))
    return "Connection cancelled in the wallet.";
  if (m.includes("loading walletconnect didn't respond") || m.includes("starting walletconnect didn't respond"))
    return "WalletConnect is taking too long to load. Check your internet, or pause any ad blocker for this site, then try again.";
  if (m.includes("didn't respond")) {
    const who = (err instanceof Error ? err.message : String(err)).replace(/ didn't respond.*/i, "");
    return `${who} didn't answer. Click the ${who} icon in your browser toolbar, a request may be waiting there. Unlock it, approve, or reject it and try again.`;
  }
  if (m.includes("already pending")) return "Your wallet already has a request open. Check the wallet app or extension.";
  if (m.includes("popup didn't open"))
    return "The WalletConnect window didn't open. If you use an ad or tracker blocker, pause it for this site and try again.";
  if (m.includes("origin") || m.includes("not allowed") || m.includes("project")) return "WalletConnect refused this site. The site's domain may not be allowed yet.";
  return `Couldn't connect: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200);
}

type Config = { mode: "demo" | "test" | "live"; mock: boolean; paid: boolean; priceUsd: number; freeChecks: number; freeLeft: number | null };

declare global {
  interface Window { ethereum?: any }
}

function shareUrl(r: Report) {
  const who = r.input.handle ? `@${r.input.handle}` : "this token";
  const text = `Ran ${who} through traction/check.\n\n${r.verdict.score}/100, ${r.verdict.label.toLowerCase()}.\n\nCheck any project before you ape:`;
  const url = typeof window !== "undefined" ? window.location.origin : "";
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

const TIERS: { key: AccountTier; label: string; hint: string }[] = [
  { key: "established", label: "Established", hint: "1k+ followers, over a year old" },
  { key: "regular", label: "Regular", hint: "200+ followers, over 3 months old" },
  { key: "new", label: "New or tiny", hint: "under 3 months old or under 200 followers" },
  { key: "fake", label: "Likely fake", hint: "default picture, or brand new with no followers" },
];

function compact(n?: number) {
  if (n === undefined) return "?";
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n);
}

function age(days?: number) {
  if (days === undefined) return "?";
  if (days < 60) return `${days}d`;
  if (days < 730) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

function WhoIsPosting({ social }: { social: Report["social"] & {} }) {
  const total = TIERS.reduce((a, t) => a + social.tiers[t.key], 0) || 1;
  const [open, setOpen] = useState(false);
  const shown = open ? social.accounts : social.accounts.slice(0, 6);
  return (
    <div className="card">
      <h3>Who's posting</h3>
      <div className="tierbar" role="img" aria-label="Share of posting accounts by quality">
        {TIERS.map((t) => social.tiers[t.key] > 0 && (
          <span key={t.key} className={`tier-${t.key}`} style={{ width: `${(social.tiers[t.key] / total) * 100}%` }} />
        ))}
      </div>
      <ul className="tierlegend">
        {TIERS.map((t) => (
          <li key={t.key} title={t.hint}>
            <i className={`tier-${t.key}`} /> {t.label} <b>{social.tiers[t.key]}</b>
          </li>
        ))}
      </ul>
      <div className="accounts">
        {shown.map((a) => {
          const ids = a.postIds ?? [];
          // Open the post that tagged the project; the profile only if X gave no post id
          const href = ids[0] ? `https://x.com/${a.handle}/status/${ids[0]}` : `https://x.com/${a.handle}`;
          return (
            <div key={a.handle} className="acct">
              <a className="acct-main" href={href} target="_blank" rel="noreferrer">
                {/* No tick here: X search marks almost every account as verified, so it tells you nothing */}
                <span className="acct-name">@{a.handle}</span>
                <span className="acct-meta">{compact(a.followers)} followers · {age(a.ageDays)} old</span>
                {a.snippet && <span className="acct-snippet">“{a.snippet}{a.snippet.length >= 140 ? "…" : ""}”</span>}
              </a>
              <span className={`pill tier-pill tier-${a.tier}`}>{TIERS.find((t) => t.key === a.tier)!.label}</span>
              {ids.length > 1 && (
                <span className="acct-posts">
                  {ids.length} posts:
                  {ids.map((id, i) => (
                    <a key={id} href={`https://x.com/${a.handle}/status/${id}`} target="_blank" rel="noreferrer">{i + 1}</a>
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {social.accounts.length > 6 && (
        <button className="small more" onClick={() => setOpen(!open)}>{open ? "Show fewer" : `Show all ${social.accounts.length}`}</button>
      )}
    </div>
  );
}

export default function Home() {
  const [config, setConfig] = useState<Config | null>(null);
  const [wallet, setWallet] = useState<{ client: WalletClient; address: `0x${string}` } | null>(null);
  const [handle, setHandle] = useState("");
  const [contract, setContract] = useState("");
  const [chain, setChain] = useState<Chain>("celo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [picker, setPicker] = useState(false);
  const [usingWC, setUsingWC] = useState(false);
  const [injected, setInjected] = useState<InjectedWallet[]>([]);
  const [walletName, setWalletName] = useState("");
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    loadConfig();
    const stop = discoverWallets((list) => {
      setInjected(list);
      // MiniPay connects on its own
      const mini = list.find((w) => w.provider?.isMiniPay);
      if (mini) connectWith(mini);
    });
    // Download WalletConnect in the background so it opens fast when tapped
    const t = setTimeout(() => preloadWalletConnect(), 1500);
    return () => { stop(); clearTimeout(t); };
  }, []);

  function loadConfig() {
    fetch("/api/config", { cache: "no-store" })
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setConfig({ mode: "demo", mock: true, paid: false, priceUsd: 0, freeChecks: 0, freeLeft: null }));
  }

  // Payment is only asked for once the free checks are used up
  const mustPay = !!config?.paid && (config.freeLeft ?? 0) === 0;

  /** Opens the wallet choice. With only one option available, skips straight to it. */
  function connect() {
    setError("");
    const hasWC = walletConnectAvailable();
    if (injected.length + (hasWC ? 1 : 0) > 1) return setPicker(true);
    if (injected.length === 1) return connectWith(injected[0]);
    if (hasWC) return connectWith("walletconnect");
    setError("No wallet found. Open this page in MiniPay or a browser with a Celo wallet.");
  }

  async function connectWith(choice: InjectedWallet | "walletconnect") {
    setPicker(false);
    setError("");
    setConnecting(true);
    const kind = choice === "walletconnect" ? "walletconnect" : "browser";
    const name = choice === "walletconnect" ? "WalletConnect" : choice.name;
    try {
      reportWalletStep(`connect-${kind}`, name);
      const provider: any = choice === "walletconnect" ? await connectWalletConnect((st) => reportWalletStep(st, name)) : choice.provider;
      const client = createWalletClient({ chain: celo, transport: custom(provider) });
      // WalletConnect waits while the person picks a wallet app, so it gets longer
      const [address] = await withTimeout(client.requestAddresses(), kind === "walletconnect" ? 180_000 : 60_000, name);
      try { await client.switchChain({ id: celo.id }); } catch { /* MiniPay and WalletConnect are already on Celo */ }
      setUsingWC(kind === "walletconnect");
      setWalletName(name);
      setWallet({ client, address });
    } catch (e) {
      reportWalletError("connect", e, name);
      if (kind === "walletconnect") await disconnectWalletConnect(); // next tap starts fresh
      setError(walletMessage(e));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (usingWC) await disconnectWalletConnect();
    setWallet(null);
    setUsingWC(false);
  }

  async function run() {
    setError("");
    setReport(null);
    if (mustPay && !wallet) return connect();
    setBusy(true);
    try {
      let doFetch: typeof fetch = fetch;
      if (mustPay && wallet) {
        // The user signs a USDT/USDC authorization for this one check. Nothing moves unless the check succeeds.
        const signer = {
          address: wallet.address,
          signTypedData: (m: any) =>
            wallet.client.signTypedData({ account: wallet.address, domain: m.domain, types: m.types, primaryType: m.primaryType, message: m.message }),
        };
        doFetch = wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: "eip155:42220", client: new ExactEvmScheme(signer as any) }] });
      }
      const res = await doFetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, contract, chain }),
      });
      const data = await res.json();
      if (data.needsPayment && config) setConfig({ ...config, freeLeft: 0 });
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setReport(data);
      loadConfig(); // refresh the free checks left
    } catch (e: any) {
      if (mustPay) reportWalletError("pay", e, walletName);
      setError(e?.message?.includes("rejected") ? "Payment was cancelled." : e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const tone = (s: number) => (s >= 65 ? "good" : s >= 40 ? "mid" : "bad");
  const buttonText = busy
    ? "Checking..."
    : connecting
      ? "Waiting for your wallet..."
      : config?.paid && !mustPay
      ? `Run free check (${config.freeLeft} left)`
      : mustPay && !wallet
        ? "Connect wallet to keep checking"
        : mustPay
          ? `Check for $${config!.priceUsd.toFixed(2)}`
          : "Run check";

  return (
    <main className="wrap">
      <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
        <filter id="ink">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.7 1.08" result="holes" />
          <feComposite in="SourceGraphic" in2="holes" operator="in" />
        </filter>
      </svg>
      {picker && (
        <div className="sheet-bg" onClick={() => setPicker(false)}>
          <div className="sheet" role="dialog" aria-label="Choose a wallet" onClick={(e) => e.stopPropagation()}>
            <h3>Connect a wallet</h3>
            {injected.map((w) => (
              <button key={w.id} className="sheet-opt" onClick={() => connectWith(w)}>
                <b>{w.icon && <img src={w.icon} alt="" width={20} height={20} className="wicon" />}{w.name}</b>
                <span>Installed in this browser</span>
              </button>
            ))}
            {walletConnectAvailable() && <button className="sheet-opt" onClick={() => connectWith("walletconnect")}>
              <b>WalletConnect</b>
              <span>Any wallet app, or scan a QR code</span>
            </button>}
            <button className="small" onClick={() => setPicker(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="top">
        <a className="brand" href="/"><img src="/logo.svg" alt="" width={34} height={34} />traction check</a>
        {/* Connect is available any time in live mode, free checks or not */}
        {wallet ? (
          <button className="small pill-btn" onClick={disconnect} title="Disconnect">
            {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)} <span aria-hidden>×</span>
          </button>
        ) : config?.paid ? (
          <button className="small" onClick={connect} disabled={connecting}>{connecting ? "Connecting..." : "Connect wallet"}</button>
        ) : null}
      </div>

      <h1>Is the hype real?</h1>
      <p className="lede">Paste a project. The agent reads its X mentions and its onchain activity, then tells you if the traction looks real or farmed.</p>

      <div className="card">
        {config?.mode === "demo" && <div className="banner">Demo mode. Results use sample data, nothing is charged.</div>}
        {config?.mode === "test" && <div className="banner">Test mode. Real X data, paid with test funds. Free for you.</div>}
        <div className="field">
          <label htmlFor="h">X handle of the project</label>
          <input id="h" placeholder="@celo or x.com/celo" value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="c">Token contract (optional)</label>
          <div className="row">
            <input id="c" placeholder="0x..." value={contract} onChange={(e) => setContract(e.target.value)} autoComplete="off" />
            <select aria-label="Chain" value={chain} onChange={(e) => setChain(e.target.value as Chain)}>
              {CHAINS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <button className="primary" disabled={busy || connecting || (!handle && !contract && !(mustPay && !wallet))} onClick={run}>{buttonText}</button>
        {config?.paid && !mustPay && (
          <p className="hint">First {config.freeChecks} checks are free. No wallet needed, and connecting one early won't use them up.</p>
        )}
        {mustPay && (
          <p className="hint">${config!.priceUsd.toFixed(2)} per check in USDT or USDC on Celo. You only pay if the check completes.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {report && (
        <section className="result">
          {report.profile && (
            <a className="card profile" href={`https://x.com/${report.profile.handle}`} target="_blank" rel="noreferrer">
              <span className="profile-label">Checked</span>
              <span className="profile-name">
                {report.profile.name || report.profile.handle}
                {report.profile.verified && <span className="tick" title="Verified">✓</span>}
              </span>
              <span className="profile-handle">
                @{report.profile.handle}
                {report.profile.followers !== undefined && <> · {compact(report.profile.followers)} followers</>}
                {report.profile.joined && !Number.isNaN(Date.parse(report.profile.joined)) && (
                  <> · joined {new Date(report.profile.joined).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</>
                )}
              </span>
              {report.profile.bio && <span className="profile-bio">{report.profile.bio}</span>}
            </a>
          )}
          <div className="card verdict">
            <div className={`score ${tone(report.verdict.score)}`}>{report.verdict.score}<small>/100</small></div>
            <p key={report.generatedAt} className={`stamp label ${tone(report.verdict.score)}`}>{report.verdict.label}</p>
            <p className="summary">{report.verdict.summary}</p>
          </div>

          {report.cachedAt && (
            <p className="hint">Checked {Math.max(1, Math.round((Date.now() - Date.parse(report.cachedAt)) / 60000))} min ago. Results refresh every 15 minutes.</p>
          )}

          <a className="share" href={shareUrl(report)} target="_blank" rel="noreferrer">Share result on X</a>

          {report.verdict.flags.length > 0 && (
            <div className="card"><h3>Red flags</h3><ul className="list">{report.verdict.flags.map((f) => <li key={f}>{f}</li>)}</ul></div>
          )}
          {report.verdict.positives.length > 0 && (
            <div className="card"><h3>Good signs</h3><ul className="list pos">{report.verdict.positives.map((f) => <li key={f}>{f}</li>)}</ul></div>
          )}

          {report.social && (
            <div className="card">
              <h3>Posts tagging @{report.profile?.handle ?? report.input.handle}, last 7 days</h3>
              {report.postsFound !== undefined && report.postsFound > (report.postsTagging ?? 0) && (
                <p className="note">
                  X returned {report.postsFound} posts. {report.postsTagging} actually tag the project and are counted.
                  The rest only matched the name or were replies in someone else's thread.
                </p>
              )}
              <div className="stats">
                <div className="stat"><b>{report.social.posts}</b><span>posts</span></div>
                <div className="stat"><b>{report.social.uniqueAuthors}</b><span>accounts</span></div>
                <div className="stat"><b>{Math.round(report.social.duplicateShare * 100)}%</b><span>copy-paste posts</span></div>
              </div>
            </div>
          )}

          {report.social && report.social.accounts?.length > 0 && <WhoIsPosting social={report.social} />}

          {report.chain && (
            <div className="card">
              <h3>Onchain, last {report.chain.windowHours}h</h3>
              <div className="stats">
                <div className="stat"><b>{report.chain.transfers}</b><span>transfers</span></div>
                <div className="stat"><b>{report.chain.uniqueSenders}</b><span>sending wallets</span></div>
                <div className="stat"><b>{report.chain.pingPongPairs}</b><span>back-and-forth pairs</span></div>
              </div>
            </div>
          )}

          <div className="card">
            <h3>What the agent paid for</h3>
            <div className="calls">
              {report.paidCalls.map((c, i) => (
                <div key={i}>
                  <span>{c.service}</span>
                  <span>
                    ${(Number(c.amountAtomic) / 1e6).toFixed(3)}{" "}
                    {c.txHash ? <a href={c.network === "celo-sepolia" ? `https://celo-sepolia.blockscout.com/tx/${c.txHash}` : `https://celoscan.io/tx/${c.txHash}`} target="_blank" rel="noreferrer">{c.network === "celo-sepolia" ? "test tx" : "tx"}</a> : c.outcome}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
