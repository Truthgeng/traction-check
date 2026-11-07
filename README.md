# traction/check

Paste a project. The agent reads its X mentions and its onchain activity, then tells you if the traction looks real or farmed.

Built for the Agents on Open Rails Hackathon, Build with buy track.

## How it works

1. A user enters an X handle and/or a token contract (Celo, Base, Ethereum, Arbitrum, BNB Chain or Hyperliquid). The first 2 checks are free with no wallet. After that each check costs $0.10 in USDT or USDC on Celo, paid with x402 through Celo's hosted facilitator. The payment is only settled if the check completes.
2. The agent pays for services it does not own through [buy](https://usebuy.ai), from its own wallet (ERC-8004 agent 10007):
   - **X profile lookup** (confirms which account is being checked)
   - **X post search** (2 calls side by side: latest and top posts tagging the project, last 7 days)
   - **Chainstack Celo RPC** (one batch reading 24h of token transfer logs, for Celo tokens)
   - **Cencori LLM inference** (writes the plain-language summary)
   - SQD data for the other chains (free route on the buy gateway)
3. The score comes from fixed rules (posting accounts, their age and size, copy-paste text, wallet spread, back-and-forth transfers), so the same project gets the same score. Results are cached for 15 minutes.
4. The result shows as soon as the data is in (about 30 seconds). The Cencori summary is written as a second step while the user is reading, through a one-time signed token so it can't be triggered without a real check.
5. Every paid call the agent made is listed on the report with its Celo transaction.

Live: https://traction-check.vercel.app · Agent card: https://traction-check.vercel.app/agent.json

## Live on Celo mainnet: proof

The live site runs in live mode (`MOCK=0`, `SANDBOX=0`) and pays on Celo mainnet. Everything below can be checked on Celoscan.

| What | Where |
|---|---|
| Agent wallet (pays buy services) | [`0xe85c29f1461ec1f550B7981A23190eC57Dd79A67`](https://celoscan.io/address/0xe85c29f1461ec1f550B7981A23190eC57Dd79A67#tokentxns) |
| ERC-8004 identity | Agent **10007**, registered by the agent wallet in [`0x27001cdb...0ea9`](https://celoscan.io/tx/0x27001cdbad49646188d87769e884452a4d5026bd8e55a663a17ede9d7d6f0ea9) (Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, tagged with attribution code `celo_b77b99cca1bd`) |
| Agent card | [traction-check.vercel.app/agent.json](https://traction-check.vercel.app/agent.json) lists `agentId: 10007` |
| PayTo (receives user payments) | [`0x3Fc08CFfDBAEf388Dc60096935379AE3c603CB0e`](https://celoscan.io/address/0x3Fc08CFfDBAEf388Dc60096935379AE3c603CB0e#tokentxns) |

Paid calls from one real check (`@celo` + the CELO token, Nov 1 2026), all from the agent wallet, paid in USDT:

| Service (via buy) | Paid | Tx |
|---|---|---|
| Chainstack Celo RPC | $0.010 | [`0xcd89559f...7e55`](https://celoscan.io/tx/0xcd89559f0802bb552e8c69202abb282557d4a1e17ad66b1b9ddd993919267e55) |
| X post search | $0.005 | [`0xb631d3f9...f72f`](https://celoscan.io/tx/0xb631d3f9ce329b1314893dc9a35e81be303a87b58819a1cd87ff5c614e25f72f) |
| X profile lookup | $0.005 | [`0xba7bba05...99ca`](https://celoscan.io/tx/0xba7bba059d85e4081af267e8ac2911371a17f6a489c1692f6b51c98547ac99ca) |
| X post search | $0.005 | [`0x2dce8706...4017`](https://celoscan.io/tx/0x2dce870662eda9da9fa8d0d6ca90d555be145e25e670e168038421ff6c294017) |
| Cencori inference | $0.010 | [`0xbcedcb24...dd38`](https://celoscan.io/tx/0xbcedcb24c80a68b580e17046d25277152c3eb40f435adb3edbc075466fccdd38) |

Every report on the site lists its own paid calls with these links, so any check a visitor runs is its own proof.

Billing rules: users pay $0.10 per check after 2 free ones. The payment is settled only when a check completes. A check that fails, or comes back incomplete because a data source failed, is never charged.

## Signals it checks

On X: how many accounts are posting vs how many posts, whether a few accounts make most of the noise, copy-paste text, share of tiny accounts, engagement.

Onchain: how many wallets moved the token, how much activity runs through 10 wallets, and wallet pairs sending back and forth (a common wash pattern).

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Modes

| Mode | Settings | What happens |
|---|---|---|
| Demo | `MOCK=1` (default) | Sample data, nothing paid |
| Test | `MOCK=0`, `SANDBOX=1`, `SANDBOX_PRIVATE_KEY` | Real X data and real onchain reads. The agent pays buy with free test USDC on Celo Sepolia, topped up by the gateway faucet. Users pay nothing. No LLM summary (Cencori has no test network). |
| Live | `MOCK=0`, `SANDBOX=0`, plus the live settings below | Everything real on Celo mainnet |

The test wallet is for test funds only. Never send real money to it.

## Going live

1. `npm run wallet` creates a fresh agent wallet and saves the key in `.env.local` on your machine. Send it $5 to $10 of USDC on Celo mainnet. Back up `.env.local`.
2. Get an API key at https://x402.celo.org (connect wallet, create key, sign). Put it in `X402_API_KEY`.
3. Set `PAY_TO` to the wallet that receives user payments.
4. Put the attribution code from your Loops House enrollment in `ATTRIBUTION_CODE`.
5. Deploy to Vercel with all the variables, `MOCK=0`, and `SITE_URL` set to the live address.
6. `npm run register` registers the agent's ERC-8004 identity from the agent wallet (gas paid in USDC). Copy the `AGENT_ID` it prints into Vercel and redeploy.

## Before the first live call, confirm against the live catalog

The X search route and body come from buy's published guide. Check them once:

```bash
curl https://gateway.usebuy.ai/v1/catalog
```

Look for the X post search capability and confirm its `url`, `inputSchema` and price match `lib/agent/social.ts`. Then do one quote (free, no payment):

```bash
npx --yes @celo/buy@0.8.5 quote -X POST -H 'content-type: application/json' \
  --data '{"query":"@celo within_time:7d","type":"latest"}' \
  https://gateway.usebuy.ai/v1/social/x/posts/search
```

## Safety

- Every paid call has a hard spend cap (`MAX_X_SEARCH`, `MAX_LLM`, `MAX_RPC`).
- A paid call is never retried automatically, since a failed paid request may already have settled.
- Post text and onchain data are treated as data, never as instructions to the LLM.
- buy is pre-1.0 beta. Keep the agent wallet small.

## Files

- `lib/agent/buy.ts` pays buy services and records receipts
- `lib/agent/social.ts` X search and social signals
- `lib/agent/onchain.ts` Chainstack (Celo) and SQD (other chains) transfer reads
- `lib/agent/verdict.ts` score and LLM verdict
- `lib/agent/run.ts` the full check
- `lib/agent/mock.ts` demo mode
- `app/agent.json/route.ts` ERC-8004 registration file
- `scripts/new-wallet.ts` creates the agent wallet (`npm run wallet`)
- `scripts/register-agent.ts` registers the ERC-8004 identity (`npm run register`)
- `app/api/check/route.ts` paid API route (x402, Celo facilitator)
- `app/page.tsx` the page
