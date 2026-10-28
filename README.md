# traction/check

Paste a project. The agent reads its X mentions and its onchain activity, then tells you if the traction looks real or farmed.

Built for the Agents on Open Rails Hackathon, Build with buy track.

## How it works

1. A user enters an X handle and/or a token contract. The first 2 checks are free with no wallet. After that they pay a small fee per check in USDT or USDC on Celo (x402, settled through Celo's hosted facilitator). They are only charged if the check completes.
2. The agent pays for services it does not own through [buy](https://usebuy.ai):
   - **X post search** (2 calls: latest and top posts, last 7 days)
   - **Chainstack Celo RPC** (token transfer logs for the last 48h, for Celo tokens)
   - **Cencori LLM inference** (writes the plain-language verdict)
   - SQD multi-chain data for Base, Ethereum, Arbitrum and BNB Chain (free route on the buy gateway)
3. A fixed rule-based score is built from the numbers, then the LLM can move it by 10 points at most and writes the summary. Same project, roughly same result every time.
4. Every paid call the agent made is shown on the report with its Celo tx hash.

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
