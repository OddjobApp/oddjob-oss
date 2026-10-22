# Public platform documentation bridge

`/docs` and `/docs/:slug` are public pages served by the login SPA. `/api/public/documentation` lists the public catalog and `/api/public/documentation/:slug` returns a platform-generated reference with a revision and source modification timestamp.

The explicit catalog in `shared/public-feature-docs.ts` selects repository-owned guides and platform feature IDs. `DocumentationService.getPublicFeatureSpec` reads those approved guides and uses the same deterministic implementation-reference generator as internal feature specifications. It calls `getFeatures()` without an organization; it never reads persisted organization knowledge, AI-generated tenant narratives, credentials, execution records, or releases. No AI inference or document write runs on a public read. Changes to deployed source/guide content appear through this bridge, with one-minute HTTP cache revalidation and ETags.

The runtime image includes platform source and guides needed by the existing scanner; tenant-authored content is not packaged. Queries selecting orgs, document IDs or paths are rejected. Unknown topic identifiers are rejected before filesystem access. The anonymous reader is rate limited. Markdown HTML and remote images are disabled; approved repository guide links are translated to public guides, unapproved source links are plain text, and GitHub destinations are suppressed. Publication is limited to this catalog, not an organization-wide sharing permission.

The source timestamp and revision describe this reference, not a completed operational run or enabled integration. Authenticated generation and maintenance of organization specs retain their existing boundaries.

## Public audience projection

The public catalog now reads only curated capability and usage guides under `server/knowledge/public-features/`. It does not append implementation references or scan internal features. Schemas, API inventories, file paths, component relationships, and internal architecture remain on authenticated documentation surfaces. Public guides are refreshed from the deployed source on each read and retain content revision fingerprints and conditional revalidation.
