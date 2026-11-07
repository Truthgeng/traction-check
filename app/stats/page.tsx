import { getStats } from "@/lib/stats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Traction Check · Live usage" };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const scan = (a: string) => `https://celoscan.io/address/${a}#tokentxns`;

/** Live usage, counted from Celo mainnet. Every number links to the explorer. */
export default async function StatsPage() {
  const s = await getStats().catch(() => null);
  return (
    <main className="wrap">
      <div className="top">
        <a className="brand" href="/"><img src="/logo.svg" alt="" width={34} height={34} />traction check</a>
      </div>
      <h1>Live usage</h1>
      <p className="lede">Counted from Celo mainnet since {s?.since ?? "launch"}. Every number links to the transactions on Celoscan.</p>
      {!s ? (
        <p className="error">Couldn't read usage from Celo right now. Try again in a minute.</p>
      ) : (
        <div className="result" style={{ marginTop: 0 }}>
          <section className="card">
            <h3>What the agent bought through buy</h3>
            <div className="stats">
              <div className="stat"><b>{s.agent.calls}</b><span>paid calls</span></div>
              <div className="stat"><b>${s.agent.usd.toFixed(2)}</b><span>spent</span></div>
              <div className="stat"><b>{s.agent.counterparties}</b><span>addresses paid</span></div>
            </div>
            <p className="hint" style={{ textAlign: "left" }}>From the agent wallet <a href={scan(s.agent.address)}>{short(s.agent.address)}</a> (ERC-8004 agent 10007).</p>
          </section>
          <section className="card">
            <h3>What people paid for checks</h3>
            <div className="stats">
              <div className="stat"><b>{s.users.payments}</b><span>paid checks</span></div>
              <div className="stat"><b>{s.users.payers}</b><span>different wallets</span></div>
              <div className="stat"><b>${s.users.usd.toFixed(2)}</b><span>paid</span></div>
            </div>
            <p className="hint" style={{ textAlign: "left" }}>Received at <a href={scan(s.users.payTo)}>{short(s.users.payTo)}</a>. Free checks (2 per visitor) don't show here.</p>
            {s.users.recent.length > 0 && (
              <div className="calls" style={{ marginTop: 12 }}>
                {s.users.recent.map((p) => (
                  <div key={p.tx}><span><a href={scan(p.from)}>{short(p.from)}</a></span><span><a href={`https://celoscan.io/tx/${p.tx}`}>tx</a></span></div>
                ))}
              </div>
            )}
          </section>
          {s.byDay.length > 0 && (
            <section className="card">
              <h3>By day</h3>
              <div className="calls">
                {s.byDay.map((d) => (
                  <div key={d.day}><span>{d.day}</span><span>{d.agentCalls} agent calls · {d.userPayments} paid checks</span></div>
                ))}
              </div>
            </section>
          )}
          <p className="hint">Updated {new Date(s.updatedAt).toUTCString()}. Refreshes every 10 minutes.</p>
        </div>
      )}
    </main>
  );
}
