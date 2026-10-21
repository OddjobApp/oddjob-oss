# Shared platform documentation

`/knowledge/platform-docs` is a read-only library of public Oddjob guides available
to every authenticated organization, including newly created organizations. The
Knowledge overview links to it. Knowledge search, RAG retrieval and the existing
MCP document search/list/read tools include its published guides.

## Publishing

Platform maintainers publish through a reviewed repository change to
`PLATFORM_DOCUMENTATION_MANIFEST` in
`server/domain/knowledge/core/platform-documentation.service.ts`, followed by a
deployment. The manifest is an explicit allowlist of public files beneath `docs/`.
Do not add tenant uploads, generated organization specifications, credentials,
customer examples containing private data, drafts or planning documents.

There is no publication, edit or deletion API for tenants. Setting a document's
metadata to `scope: platform`, or giving it a null organization ID, does not publish
it. Existing organization documents and their indexes are not migrated or widened.

## Retrieval and provenance

The immutable library builds a chunked BM25 text index once per server/worker
process. This deliberately needs no provider key, model download, extra database
or vector collection. It is lexical retrieval, not semantic vector similarity.
Organization vector retrieval continues separately and results are combined with
the platform matches. If tenant retrieval fails, available platform matches can
still be returned with an explicit server warning.

Each guide has a `platform:slug` ID, a source link and a SHA-256 content version.
The in-app reader renders the exact deployed content. The repository link can show
newer content, so compare its content hash when diagnosing a version difference.
Namespaced platform IDs never resolve through private numeric document lookups.

Explicit attachment, project, session, mission, source and temporal constraints
are not broadened to include unrelated platform guides. Restricted MCP topic or
resource scopes remain enforced. General org/project knowledge search can include
the universally readable platform corpus alongside permitted private results.

## Validation

The hermetic platform library, API and MCP tests cover two organization contexts,
new org availability, private/unlisted file exclusion, mutation isolation,
read-only routes, namespaced reads and restricted retrieval filters. All manifest
files must exist and contain content; packaging failures throw rather than silently
yielding an empty index. The Docker image already ships the `docs/` tree.
