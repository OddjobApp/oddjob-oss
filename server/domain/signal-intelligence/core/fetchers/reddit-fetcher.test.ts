/**
 * Reddit fetcher tests.
 *
 * The transport split under test was established against live Reddit on
 * 2026-08-16: unauthenticated JSON is refused (www 403s; old.reddit.com
 * redirects to a login page that 404s), while the Atom endpoint serves a full
 * listing. So the default path is Atom, and JSON is used only with OAuth.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../feed-credentials.service.js", () => ({
  resolveFeedCredentials: vi.fn(async () => null),
}));

import { redditFetcher, buildListingUrl, htmlToText } from "./reddit-fetcher.js";
import { resolveFeedCredentials } from "../feed-credentials.service.js";

const feed = {
  id: 5,
  organizationId: 7,
  url: "https://www.reddit.com/r/logistics",
  sourceType: "reddit",
  authCredentials: null,
} as any;

/** Matches the shape fast-xml-parser produces for Reddit's Atom listing. */
function atom(entries: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`;
}

/**
 * Reddit XML-escapes the HTML body of <content>, so the parser hands it back as
 * a single text node. Escaping here keeps the fixture faithful — embedding raw
 * markup instead makes fast-xml-parser treat it as child elements, which is not
 * what the live endpoint produces.
 */
function xmlEscape(html: string): string {
  return html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const REDDIT_CONTENT_HTML =
  '<!-- SC_OFF --><div class="md"><p>Full text of the post</p></div><!-- SC_ON --> &#32; submitted by &#32; <a href="https://www.reddit.com/user/x"> /u/x </a> <span><a href="https://www.reddit.com/r/logistics/comments/abc123/x/">[link]</a></span> <span><a href="x">[comments]</a></span>';

function atomEntry({
  id = "t3_abc123",
  title = "Port strike announced",
  content = xmlEscape(REDDIT_CONTENT_HTML),
  updated = "2025-10-09T07:33:20+00:00",
} = {}) {
  return `<entry>
    <author><name>/u/x</name></author>
    <category term="logistics" label="r/logistics"/>
    <content type="html">${content}</content>
    <id>${id}</id>
    <link href="https://www.reddit.com/r/logistics/comments/abc123/port_strike/"/>
    <updated>${updated}</updated>
    <title>${title}</title>
  </entry>`;
}

function ok(body: string) {
  return { ok: true, status: 200, text: async () => body };
}

describe("buildListingUrl", () => {
  it("turns a bare subreddit URL into an Atom listing", () => {
    const url = new URL(buildListingUrl("https://www.reddit.com/r/logistics"));
    expect(url.hostname).toBe("www.reddit.com");
    expect(url.pathname).toBe("/r/logistics/new.rss");
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("tolerates a trailing slash", () => {
    expect(new URL(buildListingUrl("https://www.reddit.com/r/logistics/")).pathname).toBe(
      "/r/logistics/new.rss"
    );
  });

  it("preserves a chosen sort", () => {
    expect(new URL(buildListingUrl("https://www.reddit.com/r/logistics/top")).pathname).toBe(
      "/r/logistics/top.rss"
    );
  });

  it("rewrites a .json URL to Atom when unauthenticated", () => {
    // Unauthenticated JSON is refused by Reddit, so an operator pasting a .json
    // URL must still end up on a working endpoint.
    expect(
      new URL(buildListingUrl("https://old.reddit.com/r/logistics/new.json")).pathname
    ).toBe("/r/logistics/new.rss");
  });

  it("uses the OAuth host and JSON when authenticated", () => {
    const url = new URL(buildListingUrl("https://www.reddit.com/r/logistics", true));
    expect(url.hostname).toBe("oauth.reddit.com");
    expect(url.pathname).toBe("/r/logistics/new.json");
  });

  it("rejects non-Reddit hosts", () => {
    expect(() => buildListingUrl("https://evil.example.com/r/logistics")).toThrow(
      /not a Reddit domain/
    );
  });

  it("rejects non-https URLs", () => {
    expect(() => buildListingUrl("http://www.reddit.com/r/logistics")).toThrow(/https/);
  });
});

describe("htmlToText", () => {
  it("strips markup and Reddit's submission boilerplate", () => {
    const out = htmlToText(
      '<!-- SC_OFF --><div class="md"><p>Port strike at Long Beach</p></div><!-- SC_ON --> &#32; submitted by &#32; <a href="x">/u/someone</a> <span><a href="x">[link]</a></span> <span><a href="x">[comments]</a></span>'
    );
    expect(out).toBe("Port strike at Long Beach");
  });

  it("decodes entities", () => {
    expect(htmlToText("<p>Tariffs &amp; quotas &quot;raised&quot;</p>")).toBe(
      'Tariffs & quotas "raised"'
    );
  });
});

describe("redditFetcher", () => {
  const since = new Date("2020-01-01T00:00:00.000Z");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    (resolveFeedCredentials as any).mockResolvedValue(null);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps an Atom listing into feed entries", async () => {
    fetchMock.mockResolvedValue(ok(atom(atomEntry())));

    const entries = await redditFetcher(feed, since);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "t3_abc123",
      feedId: 5,
      organizationId: 7,
      title: "Port strike announced",
      content: "Full text of the post",
      sourceUrl: "https://www.reddit.com/r/logistics/comments/abc123/port_strike/",
    });
    expect(entries[0].rawData).toMatchObject({ subreddit: "r/logistics" });
  });

  it("requests the Atom endpoint by default", async () => {
    fetchMock.mockResolvedValue(ok(atom(atomEntry())));

    await redditFetcher(feed, since);

    expect(fetchMock.mock.calls[0][0]).toContain("/r/logistics/new.rss");
  });

  it("handles a single-entry listing that parses as an object", async () => {
    // fast-xml-parser collapses a one-element list; a naive .map would throw.
    fetchMock.mockResolvedValue(ok(atom(atomEntry())));

    await expect(redditFetcher(feed, since)).resolves.toHaveLength(1);
  });

  it("filters out posts at or before the since bound", async () => {
    fetchMock.mockResolvedValue(
      ok(
        atom(
          atomEntry({ id: "t3_old", updated: "2021-01-01T00:00:00+00:00" }) +
            atomEntry({ id: "t3_new", updated: "2026-01-01T00:00:00+00:00" })
        )
      )
    );

    const entries = await redditFetcher(feed, new Date("2023-01-01T00:00:00.000Z"));

    expect(entries.map((e) => e.id)).toEqual(["t3_new"]);
  });

  it("sends a non-default user agent", async () => {
    fetchMock.mockResolvedValue(ok(atom(atomEntry())));

    await redditFetcher(feed, since);

    expect(fetchMock.mock.calls[0][1].headers["user-agent"]).toMatch(/Oddjob/);
  });

  it("uses the JSON API with a bearer token when credentials exist", async () => {
    (resolveFeedCredentials as any).mockResolvedValue({ type: "bearer", token: "tok" });
    fetchMock.mockResolvedValue(
      ok(
        JSON.stringify({
          data: {
            children: [
              {
                data: {
                  name: "t3_json1",
                  title: "From JSON",
                  selftext: "body",
                  permalink: "/r/logistics/comments/json1/x/",
                  created_utc: 1_760_000_000,
                },
              },
            ],
          },
        })
      )
    );

    const entries = await redditFetcher(feed, since);

    expect(fetchMock.mock.calls[0][0]).toContain("oauth.reddit.com");
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer tok");
    expect(entries[0]).toMatchObject({ id: "t3_json1", title: "From JSON", content: "body" });
  });

  it("raises rate limiting as a failure so backoff applies", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => "" });

    await expect(redditFetcher(feed, since)).rejects.toThrow(/rate limit/i);
  });

  it("explains a 403 rather than reporting an empty feed", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "" });

    await expect(redditFetcher(feed, since)).rejects.toThrow(/OAuth credentials/);
  });

  it("throws when the response has no Atom entries", async () => {
    // A login redirect parses as valid XML with no entries — the exact case
    // that would otherwise look like a healthy, quiet feed.
    fetchMock.mockResolvedValue(ok("<html><body>Not Found</body></html>"));

    await expect(redditFetcher(feed, since)).rejects.toThrow(/no Atom <entry>/);
  });

  it("throws on a non-OK response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "" });

    await expect(redditFetcher(feed, since)).rejects.toThrow(/HTTP 503/);
  });
});
