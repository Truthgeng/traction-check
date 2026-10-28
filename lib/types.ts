export type Chain = "celo" | "base" | "ethereum" | "arbitrum" | "bsc";

export const CHAINS: { id: Chain; label: string }[] = [
  { id: "celo", label: "Celo" },
  { id: "base", label: "Base" },
  { id: "ethereum", label: "Ethereum" },
  { id: "arbitrum", label: "Arbitrum" },
  { id: "bsc", label: "BNB Chain" },
];

export type CheckInput = {
  handle?: string; // X handle without @
  contract?: `0x${string}`;
  chain: Chain;
};

/** One paid call the agent made through buy. This is the proof judges look for. */
export type PaidCall = {
  service: "x-search" | "cencori" | "chainstack";
  url: string;
  token: string;
  amountAtomic: string;
  txHash?: string;
  outcome: "confirmed" | "rejected" | "ambiguous" | "mock";
  network?: "celo" | "celo-sepolia";
  at: string;
};

export type Post = {
  id?: string;
  text: string;
  author: string;
  followers?: number;
  authorJoined?: string; // when the posting account was created
  verified?: boolean;
  defaultAvatar?: boolean; // still on X's default profile picture
  createdAt?: string;
  likes?: number;
  reposts?: number;
};

export type AccountTier = "established" | "regular" | "new" | "fake";

/** One account that posted about the project, and how much to trust it. */
export type Account = {
  handle: string;
  posts: number;
  followers?: number;
  ageDays?: number;
  verified?: boolean;
  tier: AccountTier;
};

export type SocialSignals = {
  posts: number;
  uniqueAuthors: number;
  topAuthorShare: number; // share of posts from the 3 busiest authors
  smallAccountShare: number | null; // share of posts from accounts under 200 followers
  duplicateShare: number; // share of posts that repeat another post's text
  avgEngagement: number | null;
  /** How many posting accounts fall in each tier */
  tiers: Record<AccountTier, number>;
  /** Share of posting accounts under 90 days old, null when ages are unknown */
  newAccountShare: number | null;
  /** Posting accounts, most active first (max 25) */
  accounts: Account[];
  samples: Post[];
};

export type ChainSignals = {
  chain: Chain;
  windowHours: number;
  transfers: number;
  uniqueSenders: number;
  uniqueReceivers: number;
  topWalletShare: number; // share of transfers touching the 10 busiest wallets
  pingPongPairs: number; // pairs that sent to each other both ways
  source: "chainstack" | "sqd" | "mock";
};

export type Verdict = {
  score: number; // 0 to 100, higher = more organic
  label: "Looks organic" | "Mixed signals" | "Looks farmed" | "Not enough data";
  summary: string;
  flags: string[];
  positives: string[];
};

export type Report = {
  input: CheckInput;
  social: SocialSignals | null;
  chain: ChainSignals | null;
  verdict: Verdict;
  paidCalls: PaidCall[];
  mock: boolean;
  mode: "demo" | "test" | "live";
  generatedAt: string;
};
