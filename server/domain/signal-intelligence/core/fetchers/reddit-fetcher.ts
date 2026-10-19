/**
 * Reddit Feed Fetcher
 *
 * Retrieves new posts from a subreddit.
 *
 * TRANSPORT — established against live Reddit on 2026-08-16:
 *   www.reddit.com/r/<sub>/new.json  → 403 (browser UA, script UA and ours alike)
 *   old.reddit.com/r/<sub>/new.json  → 302 to /login/, which then 404s
 *   www.reddit.com/r/<sub>/new.rss   → 200, a full Atom listing
 * Unauthenticated JSON is closed, so this fetcher reads the Atom endpoint by
 * default and only uses the JSON API when the feed carries OAuth credentials
 * (oauth.reddit.com, the one host that accepts a bearer token).
 *
 * WHY A DEDICATED FETCHER, given the generic one already parses Atom:
 *  - Reddit refuses the default Node user agent, and the generic fetcher sends none.
 *  - Reddit rate-limits hard; a bare `.rss` request without a limit returned 429
 *    during this work. The limiter below is per-process, not per-feed.
 *  - It normalises `/r/<sub>` into a listing URL, so operators can paste the
 *    subreddit link they actually have.
 *  - It preserves Reddit-native identity (`t3_…`), permalinks, author and
 *    subreddit into rawData, which the generic parser discards.
 *  - It strips Reddit's HTML boilerplate ("submitted by … [link] [comments]")
 *    that would otherwise dominate the text handed to event extraction.
 */

import { createLogger } from "@server/utils/logger.js";
import { ValidationError } from "@server/utils/errors.js";
import { TokenBucketRateLimiter } from "@domain/jobs/core/utils/rate-limiter.js";
import { XMLParser } from "fast-xml-parser";
import type { FeedEntry, FeedFetcher } from "../signal-ingestion.service.js";
import { resolveFeedCredentials } from "../feed-credentials.service.js";

const logger = createLogger("RedditFetcher");

const ALLOWED_HOSTS = new Set([
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "oauth.reddit.com",
]);

/**
 * Reddit asks clients to stay near 10 requests/minute and returns 429 past that.
 * One bucket for the whole process: the limit is applied per client, so
 * per-feed buckets would let ten subreddits collectively blow through it.
 */
const rateLimiter = new TokenBucketRateLimiter(10, 10 / 60);

/** Reddit 403s or 429s the default Node user agent. */
function userAgent(): string {
  return (
    process.env.REDDIT_USER_AGENT ??
    "Oddjob-SignalIntelligence/1.0 (signal feed poller)"
  );
}

/**
 * Normalise a feed URL into a listing endpoint.
 * Accepts `https://www.reddit.com/r/<sub>`, `.../r/<sub>/new.rss`, `.../new.json`.
 *
 * Unauthenticated → Atom on www.reddit.com. Authenticated → JSON on
 * oauth.reddit.com. See the transport note at the top of this file.
 */
export function buildListingUrl(rawUrl: string, authenticated = false): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ValidationError(`Invalid Reddit feed URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== "https:") {
    throw new ValidationError("Reddit feed URLs must use https.");
  }
  // Host allowlist rather than the generic SSRF check: a "reddit" feed pointing
  // anywhere else is a misconfiguration, and this parsing would be meaningless
  // against a non-Reddit payload anyway.
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new ValidationError(
      `Reddit feed URL host "${parsed.hostname}" is not a Reddit domain.`
    );
  }

  const suffix = authenticated ? ".json" : ".rss";
  parsed.hostname = authenticated ? "oauth.reddit.com" : "www.reddit.com";

  // Strip whichever listing suffix is present, then apply the right one.
  let path = parsed.pathname.replace(/\/+$/, "");
  path = path.replace(/\.(rss|json)$/, "");
  if (!/\/(new|hot|top|rising|controversial)$/.test(path)) {
    path = `${path}/new`;
  }
  parsed.pathname = `${path}${suffix}`;

  if (!parsed.searchParams.has("limit")) {
    parsed.searchParams.set("limit", "100");
  }

  return parsed.toString();
}

/**
 * Reddit wraps post bodies in HTML and appends a "submitted by … [link]
 * [comments]" footer. Downstream extraction is an LLM reading `content`, so
 * markup and boilerplate are pure noise.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#32;/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s*\[link\]\s*/gi, " ")
    .replace(/\s*\[comments\]\s*/gi, " ")
    .replace(/\bsubmitted by\b\s*\/u\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in (value as any)) {
    const inner = (value as any)["#text"];
    return typeof inner === "string" ? inner : undefined;
  }
  return undefined;
}

/** Map one Atom entry to a FeedEntry. */
function atomEntryToFeedEntry(
  entry: any,
  feed: { id: number; organizationId: number }
): FeedEntry | null {
  const id = text(entry?.id);
  const title = text(entry?.title);
  if (!id || !title) return null;

  const rawContent = text(entry?.content) ?? "";
  const body = htmlToText(rawContent);
  const href = entry?.link?.["@_href"] ?? entry?.link;
  const dateStr = text(entry?.updated) ?? text(entry?.published);
  const published = dateStr ? new Date(dateStr) : null;

  return {
    id,
    feedId: feed.id,
    organizationId: feed.organizationId,
    sourceUrl: typeof href === "string" ? href : "https://www.reddit.com",
    title,
    // A link post has no body; the title is the whole signal there.
    content: body.length > 0 ? body : title,
    publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    retrievedAt: new Date(),
    rawData: {
      author: entry?.author?.name,
      subreddit: entry?.category?.["@_label"] ?? entry?.category?.["@_term"],
      permalink: typeof href === "string" ? href : undefined,
    },
  };
}

/** Map one JSON listing child to a FeedEntry. */
function jsonPostToFeedEntry(
  post: any,
  feed: { id: number; organizationId: number }
): FeedEntry | null {
  const id = post?.name ?? (post?.id ? `t3_${post.id}` : null);
  if (!id || !post?.title) return null;

  const createdMs =
    typeof post.created_utc === "number" ? post.created_utc * 1000 : null;

  return {
    id,
    feedId: feed.id,
    organizationId: feed.organizationId,
    sourceUrl: post.permalink
      ? `https://www.reddit.com${post.permalink}`
      : (post.url ?? "https://www.reddit.com"),
    title: post.title,
    content:
      post.selftext && post.selftext.length > 0 ? post.selftext : post.title,
    publishedAt: createdMs === null ? null : new Date(createdMs),
    retrievedAt: new Date(),
    rawData: {
      author: post.author,
      subreddit: post.subreddit,
      score: post.score,
      numComments: post.num_comments,
      permalink: post.permalink,
      url: post.url,
      over18: post.over_18,
    },
  };
}

export const redditFetcher: FeedFetcher = async (feed, since) => {
  await rateLimiter.acquire();

  const credentials = await resolveFeedCredentials(feed);
  const authenticated = Boolean(credentials?.token);
  const listingUrl = buildListingUrl(feed.url, authenticated);

  const headers: Record<string, string> = {
    accept: authenticated
      ? "application/json"
      : "application/atom+xml, application/xml;q=0.9",
    "user-agent": userAgent(),
  };
  if (credentials?.token) headers.authorization = `Bearer ${credentials.token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(listingUrl, { headers, signal: controller.signal });

    if (response.status === 429) {
      // Surfaced as a feed failure so the poller's backoff applies, rather than
      // hammering a limiter that is already exhausted.
      throw new Error("Reddit rate limit exceeded (HTTP 429)");
    }
    if (response.status === 403 || response.status === 401) {
      throw new Error(
        `Reddit refused the request (HTTP ${response.status}). ` +
          (authenticated
            ? "Check the feed's OAuth token."
            : "Unauthenticated Reddit access is restricted; add OAuth credentials to this feed.")
      );
    }
    if (!response.ok) {
      throw new Error(`Reddit returned HTTP ${response.status}`);
    }

    const body = await response.text();
    let candidates: (FeedEntry | null)[];

    if (authenticated) {
      const parsed = JSON.parse(body);
      const children = parsed?.data?.children;
      if (!Array.isArray(children)) {
        throw new Error(
          "Unexpected Reddit JSON shape: expected data.children[]. " +
            "Check the URL points at a subreddit listing."
        );
      }
      candidates = children.map((c: any) => jsonPostToFeedEntry(c?.data ?? {}, feed));
    } else {
      const parsed = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
      }).parse(body);
      const raw = parsed?.feed?.entry;
      if (raw === undefined) {
        // A login redirect or an error page parses fine but has no entries —
        // exactly the case that would otherwise look like a healthy empty feed.
        throw new Error(
          "Unexpected Reddit response: no Atom <entry> elements. " +
            "The subreddit may be private, banned, or the URL may be wrong."
        );
      }
      const list = Array.isArray(raw) ? raw : [raw];
      candidates = list.map((e: any) => atomEntryToFeedEntry(e, feed));
    }

    const entries: FeedEntry[] = [];
    for (const entry of candidates) {
      if (!entry) continue;
      // Listings are newest-first but not strictly monotonic, so filter rather
      // than break. Undated posts are kept — dropping them would lose signal
      // permanently, and dedup catches repeats.
      if (entry.publishedAt && entry.publishedAt <= since) continue;
      entries.push(entry);
    }

    logger.info(
      `Reddit feed ${feed.id}: ${entries.length} new of ${candidates.length} returned ` +
        `(${authenticated ? "json" : "atom"}).`
    );
    return entries;
  } finally {
    clearTimeout(timer);
  }
};
