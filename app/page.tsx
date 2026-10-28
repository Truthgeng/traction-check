"use client";

import { useEffect, useState } from "react";
import { createWalletClient, custom, type WalletClient } from "viem";
import { celo } from "viem/chains";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { CHAINS, type Chain, type Report } from "@/lib/types";

type Config = { mock: boolean; paid: boolean; priceUsd: number };

declare global {
  interface Window { ethereum?: any }
}

function shareUrl(r: Report) {
  const who = r.input.handle ? `@${r.input.handle}` : "this token";
  const text = `Ran ${who} through traction/check.\n\n${r.verdict.score}/100, ${r.verdict.label.toLowerCase()}.\n\nCheck any project before you ape:`;
  const url = typeof window !== "undefined" ? window.location.origin : "";
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

export default function Home() {
  const [config, setConfig] = useState<Config | null>(null);
  const [wallet, setWallet] = useState<{ client: WalletClient; address: `0x${string}` } | null>(null);
  const [handle, setHandle] = useState("");
  const [contract, setContract] = useState("");
  const [chain, setChain] = useState<Chain>("celo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => setConfig({ mock: true, paid: false, priceUsd: 0 }));
    // MiniPay connects on its own
    if (typeof window !== "undefined" && window.ethereum?.isMiniPay) connect();
  }, []);

  async function connect() {
    setError("");
    if (!window.ethereum) {
      setError("No wallet found. Open this page in MiniPay or a browser with a Celo wallet.");
      return;
    }
    try {
      const client = createWalletClient({ chain: celo, transport: custom(window.ethereum) });
      const [address] = await client.requestAddresses();
      try { await client.switchChain({ id: celo.id }); } catch { /* MiniPay is already on Celo */ }
      setWallet({ client, address });
    } catch {
      setError("Wallet connection was cancelled.");
    }
  }

  async function run() {
    setError("");
    setReport(null);
    if (config?.paid && !wallet) return connect();
    setBusy(true);
    try {
      let doFetch: typeof fetch = fetch;
      if (config?.paid && wallet) {
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
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setReport(data);
    } catch (e: any) {
      setError(e?.message?.includes("rejected") ? "Payment was cancelled." : e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const tone = (s: number) => (s >= 65 ? "good" : s >= 40 ? "mid" : "bad");
  const buttonText = busy
    ? "Checking..."
    : config?.paid && !wallet
      ? "Connect wallet"
      : config?.paid
        ? `Check for $${config.priceUsd.toFixed(2)}`
        : "Run check";

  return (
    <main className="wrap">
      <div className="top">
        <div className="brand">traction<span>/</span>check</div>
        {wallet ? <span className="pill">{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</span>
          : config?.paid ? <button className="small" onClick={connect}>Connect</button> : null}
      </div>

      <h1>Is the hype real?</h1>
      <p className="lede">Paste a project. The agent reads its X mentions and its onchain activity, then tells you if the traction looks real or farmed.</p>

      <div className="card">
        {config?.mock && <div className="banner">Demo mode. Results use sample data, nothing is charged.</div>}
        <div className="field">
          <label htmlFor="h">X handle</label>
          <input id="h" placeholder="@project" value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="off" />
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
        <button className="primary" disabled={busy || (!handle && !contract)} onClick={run}>{buttonText}</button>
        {config?.paid && <p className="hint">Paid in USDT or USDC on Celo. You only pay if the check completes.</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {report && (
        <section className="result">
          <div className="card verdict">
            <div className={`score ${tone(report.verdict.score)}`}>{report.verdict.score}<small>/100</small></div>
            <div>
              <p className={`label ${tone(report.verdict.score)}`}>{report.verdict.label}</p>
              <p className="summary">{report.verdict.summary}</p>
            </div>
          </div>

          <a className="share" href={shareUrl(report)} target="_blank" rel="noreferrer">Share result on X</a>

          {report.verdict.flags.length > 0 && (
            <div className="card"><h3>Red flags</h3><ul className="list">{report.verdict.flags.map((f) => <li key={f}>{f}</li>)}</ul></div>
          )}
          {report.verdict.positives.length > 0 && (
            <div className="card"><h3>Good signs</h3><ul className="list pos">{report.verdict.positives.map((f) => <li key={f}>{f}</li>)}</ul></div>
          )}

          {report.social && (
            <div className="card">
              <h3>On X, last 7 days</h3>
              <div className="stats">
                <div className="stat"><b>{report.social.posts}</b><span>posts</span></div>
                <div className="stat"><b>{report.social.uniqueAuthors}</b><span>accounts</span></div>
                <div className="stat"><b>{Math.round(report.social.duplicateShare * 100)}%</b><span>copy-paste posts</span></div>
              </div>
            </div>
          )}

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
                    {c.txHash ? <a href={`https://celoscan.io/tx/${c.txHash}`} target="_blank" rel="noreferrer">tx</a> : c.outcome}
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
