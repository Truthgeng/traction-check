import { paidPost } from "./buy";
import type { Account, PaidCall, Post, Profile, SocialSignals } from "@/lib/types";

/**
 * X search through the buy gateway.
 * Route and body follow buy's published guide:
 *   POST /v1/social/x/posts/search  {"query": "...", "type": "latest" | "top"}
 * CONFIRM against the live catalog before going live (GET /v1/catalog).
 */
const X_SEARCH_PATH = "/v1/social/x/posts/search";

export async function searchX(
  query: string,
  type: "latest" | "top",
  receipts: PaidCall[],
  cursor?: string,
): Promise<{ posts: Post[]; next?: string }> {
  const raw = await paidPost(
    "x-search",
    X_SEARCH_PATH,
    cursor ? { query, type, cursor } : { query, type },
    process.env.MAX_X_SEARCH || "0.02",
    receipts,
  );
  const posts = extractPosts(raw);
  const next = findCursor(raw);
  if (!next) console.warn(`x search (${type}) gave no next-page cursor; top-level keys:`, JSON.stringify(Object.keys((raw as any)?.output?.data ?? (raw as any)?.data ?? raw ?? {})));
  // If nothing was recognised, log the start of the reply so the format can be fixed from the Vercel logs
  if (!posts.length) console.warn(`x search (${type}) returned no recognisable posts:`, JSON.stringify(raw).slice(0, 800));
  return { posts, next };
}

/**
 * Looks up the X account being checked, so the report can show exactly which
 * project it ran on. Paid call on buy (TikHub "Fetch User Profile", $0.005).
 * Returns null when X has no such account.
 */
const X_PROFILE_PATH = "/v1/social/x/tools/tikhub-api-v1-twitter-web-fetch-user-profile";

export async function fetchProfile(handle: string, receipts: PaidCall[]): Promise<Profile | null> {
  const raw = await paidPost(
    "x-profile",
    X_PROFILE_PATH,
    { queryParams: { screen_name: handle } },
    process.env.MAX_X_SEARCH || "0.02",
    receipts,
  );
  const want = handle.toLowerCase();
  let found: Record<string, any> | null = null;
  const visit = (node: any, depth: number) => {
    if (found || !node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) { for (const n of node) visit(n, depth + 1); return; }
    // TikHub puts the username in "profile"; other X shapes use screen_name / username
    const sn =
      node.screen_name ?? node.username ?? node.core?.screen_name ?? node.legacy?.screen_name ??
      (typeof node.profile === "string" ? node.profile : undefined);
    if (typeof sn === "string" && sn.toLowerCase() === want) {
      found = { ...(node.legacy ?? {}), ...(node.core ?? {}), ...node };
      return;
    }
    for (const v of Object.values(node)) visit(v, depth + 1);
  };
  visit(raw, 0);
  // TikHub marks the account state; anything but "active" (not found, suspended) means no usable account
  const state = (found as Record<string, any> | null)?.status ?? (raw as any)?.output?.status;
  if (typeof state === "string" && state.toLowerCase() !== "active") return null;
  if (!found) {
    console.warn(`profile @${handle} not recognised:`, JSON.stringify(raw).slice(0, 600));
    return null;
  }
  const f = found as Record<string, any>;
  if (f.sub_count === undefined && f.followers_count === undefined && f.followers === undefined) {
    console.warn(`profile @${handle}: no follower field, keys:`, Object.keys(f).join(","));
  }
  return {
    handle: String(f.screen_name ?? f.username ?? (typeof f.profile === "string" ? f.profile : handle)),
    name: f.name,
    bio: typeof f.description === "string" ? f.description : typeof f.desc === "string" ? f.desc : undefined,
    followers: num(f.followers_count ?? f.followers ?? f.sub_count ?? f.normal_followers_count),
    joined: f.created_at ?? f.createdAt,
    verified: Boolean(f.verified || f.is_blue_verified || f.blue_verified || f.verified_type),
  };
}

/**
 * Reads up to `pages` pages of one search type, following the next-page cursor.
 * Each page is one paid call (about $0.005).
 */
export async function searchXPages(query: string, type: "latest" | "top", pages: number, receipts: PaidCall[]) {
  const all: Post[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < pages; i++) {
    const { posts, next } = await searchX(query, type, receipts, cursor);
    all.push(...posts);
    if (!next || !posts.length) break;
    cursor = next;
  }
  return all;
}

/** Finds the provider's next-page cursor wherever it sits in the reply. */
function findCursor(node: any, depth = 0): string | undefined {
  if (!node || typeof node !== "object" || depth > 4 || Array.isArray(node)) return undefined;
  for (const k of ["next_cursor", "nextCursor", "cursor_bottom", "bottom_cursor", "next_token"]) {
    if (typeof node[k] === "string" && node[k]) return node[k];
  }
  for (const v of Object.values(node)) {
    const c = findCursor(v, depth + 1);
    if (c) return c;
  }
  return undefined;
}

/**
 * The provider (TikHub, per the buy catalog) does not publish its response shape,
 * so this walks the result
 * and picks out anything that looks like a post. Field names cover the common
 * X API and scraper shapes.
 */
export function extractPosts(raw: unknown): Post[] {
  const out: Post[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown, depth: number) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, any>;
    const rawText = o.full_text ?? o.text ?? o.content ?? o.legacy?.full_text;
    const text = typeof rawText === "string" ? decodeEntities(rawText) : rawText;
    const user = o.user_info ?? o.author ?? o.user ?? o.core?.user_results?.result?.legacy;
    const author =
      (typeof user === "string" ? user : user?.screen_name ?? user?.username ?? user?.userName ?? user?.handle) ??
      o.author_username ?? o.username ?? o.screen_name;

    if (typeof text === "string" && typeof author === "string") {
      const id = String(o.tweet_id ?? o.id_str ?? o.id ?? o.rest_id ?? `${author}:${text.slice(0, 40)}`);
      if (!seen.has(id)) {
        seen.add(id);
        out.push({
          id,
          text,
          author: author.replace(/^@/, "").toLowerCase(),
          followers: num(user?.followers_count ?? user?.followers ?? user?.followersCount ?? o.author_followers),
          // Account fields, as TikHub sends them in user_info (checked against a live reply)
          authorJoined: typeof user === "object" ? user?.created_at ?? user?.createdAt : undefined,
          verified: typeof user === "object" ? Boolean(user?.verified || user?.is_blue_verified || user?.verified_type) : undefined,
          defaultAvatar:
            typeof user === "object" && typeof user?.avatar === "string" ? /default_profile/.test(user.avatar) : undefined,
          createdAt: o.created_at ?? o.createdAt ?? o.date,
          bodyMentions: bodyMentions(o, text),
          likes: num(o.favorites ?? o.favorite_count ?? o.likes ?? o.likeCount ?? o.public_metrics?.like_count),
          reposts: num(o.retweets ?? o.retweet_count ?? o.retweetCount ?? o.public_metrics?.retweet_count),
        });
      }
      return;
    }
    for (const v of Object.values(o)) visit(v, depth + 1);
  };

  visit(raw, 0);
  return out;
}

/**
 * Handles the person deliberately tagged, i.e. inside the visible body of the post.
 * When someone replies, X puts the thread's handles in front of the text
 * automatically ("@a @b @c actual reply"); display_text_range marks where the
 * typed text starts, so tags before it are skipped.
 */
function bodyMentions(o: Record<string, any>, text: string): string[] {
  const legacy = o.legacy ?? o;
  const range: unknown = legacy.display_text_range;
  const bodyStart = Array.isArray(range) && typeof range[0] === "number" ? range[0] : leadingMentionsEnd(text);
  const list = legacy.entities?.user_mentions ?? legacy.entities?.mentions;
  if (Array.isArray(list) && list.length) {
    return list
      .filter((m: any) => {
        const start = Array.isArray(m.indices) ? m.indices[0] : m.start;
        return typeof start !== "number" || start >= bodyStart;
      })
      .map((m: any) => String(m.screen_name ?? m.username ?? "").toLowerCase())
      .filter(Boolean);
  }
  // No entity data: read the handles from the typed part of the text
  return [...text.slice(bodyStart).matchAll(/(?:^|[^\w@])@(\w{1,15})/g)].map((m) => m[1].toLowerCase());
}

/** Where a run of leading "@a @b " reply handles ends (fallback when X gives no range). */
function leadingMentionsEnd(text: string): number {
  const m = text.match(/^(?:@\w{1,15}\s+)+/);
  return m ? m[0].length : 0;
}

// X returns text HTML-escaped (&amp; and friends)
function decodeEntities(t: string) {
  return t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

const DAY = 86_400_000;

/** Sorts a posting account into a trust tier, from the fields X actually gives us. */
export function tierFor(a: { followers?: number; ageDays?: number; defaultAvatar?: boolean }): Account["tier"] {
  const f = a.followers;
  const age = a.ageDays;
  if (a.defaultAvatar || (age !== undefined && age < 30 && (f ?? 0) < 50)) return "fake";
  if ((age !== undefined && age < 90) || (f !== undefined && f < 200)) return "new";
  if ((f ?? 0) >= 1000 && (age === undefined || age >= 365)) return "established";
  return "regular";
}

/** Turns raw posts into the numbers the verdict is built from. */
export function socialSignals(posts: Post[]): SocialSignals {
  const byAuthor = new Map<string, number>();
  for (const p of posts) byAuthor.set(p.author, (byAuthor.get(p.author) ?? 0) + 1);
  const counts = [...byAuthor.values()].sort((a, b) => b - a);
  const top3 = counts.slice(0, 3).reduce((a, b) => a + b, 0);

  const withFollowers = posts.filter((p) => p.followers !== undefined);
  const small = withFollowers.filter((p) => (p.followers ?? 0) < 200).length;

  // Near-duplicate text: lowercase, strip links, handles, numbers, punctuation
  const norm = (t: string) =>
    t.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/@\w+/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const textCount = new Map<string, number>();
  for (const p of posts) {
    const k = norm(p.text).slice(0, 120);
    if (k.length > 15) textCount.set(k, (textCount.get(k) ?? 0) + 1);
  }
  let dupes = 0;
  for (const c of textCount.values()) if (c > 1) dupes += c;

  const eng = posts.filter((p) => p.likes !== undefined || p.reposts !== undefined);
  const avgEngagement = eng.length
    ? eng.reduce((a, p) => a + (p.likes ?? 0) + (p.reposts ?? 0), 0) / eng.length
    : null;

  // One row per posting account
  const accountMap = new Map<string, Account & { defaultAvatar?: boolean }>();
  for (const p of posts) {
    const existing = accountMap.get(p.author);
    if (existing) { existing.posts++; continue; }
    const joined = p.authorJoined ? Date.parse(p.authorJoined) : NaN;
    const ageDays = Number.isFinite(joined) ? Math.max(0, Math.floor((Date.now() - joined) / DAY)) : undefined;
    accountMap.set(p.author, { handle: p.author, posts: 1, followers: p.followers, ageDays, verified: p.verified, defaultAvatar: p.defaultAvatar, tier: "regular" });
  }
  const tiers: Record<Account["tier"], number> = { established: 0, regular: 0, new: 0, fake: 0 };
  const accounts: Account[] = [];
  for (const a of accountMap.values()) {
    a.tier = tierFor(a);
    tiers[a.tier]++;
    const { defaultAvatar, ...row } = a;
    accounts.push(row);
  }
  accounts.sort((a, b) => b.posts - a.posts || (b.followers ?? 0) - (a.followers ?? 0));
  const aged = accounts.filter((a) => a.ageDays !== undefined);
  const newAccountShare = aged.length >= 5 ? aged.filter((a) => (a.ageDays ?? 0) < 90).length / aged.length : null;

  return {
    posts: posts.length,
    uniqueAuthors: byAuthor.size,
    topAuthorShare: posts.length ? top3 / posts.length : 0,
    smallAccountShare: withFollowers.length >= 5 ? small / withFollowers.length : null,
    duplicateShare: posts.length ? dupes / posts.length : 0,
    avgEngagement,
    tiers,
    newAccountShare,
    accounts: accounts.slice(0, 25),
    samples: posts.slice(0, 8),
  };
}
