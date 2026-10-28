import { paidPost } from "./buy";
import type { PaidCall, Post, SocialSignals } from "@/lib/types";

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
): Promise<Post[]> {
  const raw = await paidPost(
    "x-search",
    X_SEARCH_PATH,
    { query, type },
    process.env.MAX_X_SEARCH || "0.02",
    receipts,
  );
  const posts = extractPosts(raw);
  // If nothing was recognised, log the start of the reply so the format can be fixed from the Vercel logs
  if (!posts.length) console.warn(`x search (${type}) returned no recognisable posts:`, JSON.stringify(raw).slice(0, 800));
  return posts;
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
          createdAt: o.created_at ?? o.createdAt ?? o.date,
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

// X returns text HTML-escaped (&amp; and friends)
function decodeEntities(t: string) {
  return t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
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

  return {
    posts: posts.length,
    uniqueAuthors: byAuthor.size,
    topAuthorShare: posts.length ? top3 / posts.length : 0,
    smallAccountShare: withFollowers.length >= 5 ? small / withFollowers.length : null,
    duplicateShare: posts.length ? dupes / posts.length : 0,
    avgEngagement,
    samples: posts.slice(0, 8),
  };
}
