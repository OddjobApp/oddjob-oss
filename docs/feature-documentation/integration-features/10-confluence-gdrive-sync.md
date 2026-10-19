# Confluence & Google Drive Sync

## Overview

Both `ConfluenceSyncExecutor` and `GoogleDriveSyncExecutor` ingest external content into Oddjob's Knowledge Store. This document covers pagination behaviour, safety caps, and configuration options added in Sprint 1.4.

---

## Confluence Sync

### What Changed

Previously the executor fetched **at most 50 pages per space** with a hard-coded single API call. It now uses full offset pagination through two new helpers on `ConfluenceClient`:

| Method | Description |
|---|---|
| `getAllPagesInSpace(spaceKey, pageSize?, maxPages?)` | Follows `start` offset until batch < pageSize |
| `getAllSpaces(pageSize?, maxSpaces?)` | Follows `start` offset until batch < pageSize |

### Configuration

| Config Field | Type | Default | Description |
|---|---|---|---|
| `credentialId` | `number` | required | Confluence credential ID |
| `spaceKeys` | `string[]` | `[]` | Space keys to sync. Empty = sync **all** discovered spaces |
| `knowledgeTopicId` | `number` | required | Target knowledge topic |
| `maxPagesPerSpace` | `number` | `1000` | Safety cap: stop after this many pages per space |

### Pagination Behaviour

The Confluence REST API uses `start` + `limit` offset pagination. The executor requests pages in batches of **50** and stops when:
- The batch size returned is smaller than the page size (signals last page), or
- The running total reaches `maxPagesPerSpace`.

```
Request 1: GET /rest/api/content?spaceKey=DOCS&limit=50&start=0  → 50 results
Request 2: GET /rest/api/content?spaceKey=DOCS&limit=50&start=50 → 50 results
Request 3: GET /rest/api/content?spaceKey=DOCS&limit=50&start=100 → 23 results  ← stop
```

---

## Google Drive Sync

### Bugs Fixed

A misplaced early-return on the `foldersToSync.length === 0` check was placed **after** the folders array was populated from config/metadata, causing all syncs to fail immediately with "No folders specified to sync." This is now fixed — the guard only triggers when the folders array is genuinely empty.

### Configuration

| Config Field | Type | Default | Description |
|---|---|---|---|
| `credentialId` | `number` | required | Google Drive credential ID |
| `folderIds` | `string[]` | `[]` | Drive folder IDs. Falls back to credential `folderId` metadata |
| `knowledgeTopicId` | `number` | required | Target knowledge topic |
| `recursive` | `boolean` | `true` | Walk sub-folders |
| `maxFiles` | `number` | `1000` | Safety cap: stop after this many files processed (was hard-coded 200) |

---

## Files Changed

| File | Change |
|---|---|
| `server/domain/integrations/core/confluence.service.ts` | Added `getAllPagesInSpace`, `getAllSpaces` to the low-level client |
| `server/domain/integrations/confluence-service.ts` | Added `getAllPagesInSpace`, `getAllSpaces` to the gateway-backed `ConfluenceClient` |
| `server/domain/integrations/tests/confluence-pagination.test.ts` | Pagination unit tests |

> **Correction (Aug 2026).** The two executor rows previously listed here pointed at
> `server/domain/pipeline/core/executors/`, a duplicate executor tree that was never
> wired into the runtime and has since been deleted. The executors that actually run
> live in `server/domain/jobs/core/executors/`, and they paginate differently:
>
> - `jobs/core/executors/confluence-sync-executor.ts` drives pagination itself — it
>   calls the single-page `getPagesInSpace(space, limit, start)` in a loop, advancing
>   `start` by `limit` until a page comes back empty, with a 10,000-page safety break.
>   It does **not** call `getAllPagesInSpace()`, and there is no `maxPagesPerSpace`
>   config. Spaces are fetched via `getSpaces(50)`, so a sync covers at most 50 spaces.
> - `jobs/core/executors/google-drive-sync-executor.ts` pages correctly via
>   `nextPageToken` and has no early-return bug, but it has **no `maxFiles` cap** —
>   a large folder is fetched in full.
>
> `getAllPagesInSpace()` / `getAllSpaces()` on the client are still used, by
> `server/domain/integrations/saas-sync.service.ts`.
