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
4. Put the attribution code from your Loops House enrollment in `ATTRIBUTION_CODE`. Keep it in `.env.local` and your Vercel environment variables. Do not commit `.env.local` or your wallet private key.
5. Deploy to Vercel with all the variables, `MOCK=0`, and `SITE_URL` set to the live address.
6. `npm run register` registers the agent's ERC-8004 identity from the agent wallet (gas paid in USDC). The registration transaction is sent through the Celo attribution SDK using `ATTRIBUTION_CODE`. Copy the `AGENT_ID` it prints into Vercel and redeploy.

**Attribution and x402:** The SDK tags transactions signed directly by the agent wallet. Celo's hosted x402 facilitator currently submits x402 settlements without an attribution tag, so those payments are associated with your project through the `PAY_TO` wallet address. Include that address when the hackathon asks for your x402 payment wallet. Tags cannot be added to transactions after they have been sent.

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
