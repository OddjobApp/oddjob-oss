# Public documentation bridge

`/docs` and `/docs/:slug` are served by the public SPA. The explicit catalog in `shared/public-feature-docs.ts` selects capability and usage guides under `server/knowledge/public-features/`. Reads use current deployed guide content, revision fingerprints, source timestamps, ETags, and one-minute cache revalidation. They do not scan schemas, API inventories, component relationships, tenant knowledge, or internal generated specifications. Authenticated documentation generation remains available separately.

Public reads reject query selectors and unknown topics, are rate limited, and never invoke AI or write documents. Markdown HTML and remote images are disabled; GitHub destinations are suppressed.

## Dynamic public release notes

`/docs/releases` reads `/api/public/documentation/releases`, refreshes every minute and on window focus, and shows an empty state until an explicit public summary is published. Configure `PUBLIC_RELEASE_NOTES_ORG_ID` to the platform publishing organization. Without it the feed is empty. This is a source restriction, never a caller-selected tenant.

In Documentation Manager → Release notes, a platform administrator can enter a customer-facing **Public release summary** before publishing. Only the configured publishing organization can do this. Empty summaries keep releases internal. The anonymous projection includes only title, version, publication date and the explicit summary; it never includes internal release markdown, change IDs, schema diffs, or organization identifiers. Drafts and ordinary internal publications stay private. Review the public summary for suitability before pressing Publish.

## Crawlers

`client/public/robots.txt` permits public pages and the public documentation feed, while excluding private workspace, authentication, tenant deployment and API paths. Robots rules are crawler guidance, not authorization; server access controls still apply.
