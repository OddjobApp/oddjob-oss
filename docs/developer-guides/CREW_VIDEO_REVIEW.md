# CREW video review feasibility

Status: explored; video ingestion is not enabled by this change.

## Existing foundations

CREW persists organization-scoped file blobs and room attachment references.
The attachment service extracts searchable text, reports parse failures, and
indexes asynchronously. Agents already have list, text-reading, and search tools.
GoogleClient accepts Gemini file attachments as `fileData` and accepts native
multimodal parts through `messages`. OrganizationAIClient resolves the owning
organization's Gemini connection and meters calls.

The image ingestion fix passes the attachment's organization ID into this client
and removes the development-key prerequisite. Uploads that failed previously
remain failed in stored blobs; this change does not silently reprocess them.

## Recommended implementation

Add a video recognition service behind the existing attachment service, rather
than a second attachment store or a separate agent chat system. Begin with MP4
and WebM and keep the existing 25 MiB upload limit for the pilot. Process video
asynchronously so file upload does not wait on media processing or inference.
Show processing, ready, failed, and unsupported states in the attachment bar.

Use native Gemini video understanding, which handles audio and visual content,
to produce a summary and timestamped segments containing observed actions,
visible text, speech, and uncertainties. Validate structured output and mark it
as model-derived interpretation. Store segment metadata in parsedData and a
timestamped textual representation in parsedText so existing reading and search
tools work. Keep the original video as the source; a summary is not exhaustive
evidence. Link citations to attachment ID and segment start/end times.

Use the organization's resolved Gemini key for both upload and inference. An
uploaded Gemini file belongs to that key, so resolve one connection consistently
across both operations. Do not persist credentials in file metadata. Clean up
temporary provider files after processing, including failure paths.

## Gaps to resolve before enabling

- The current attachment chooser does not accept video files.
- The current parser has no video branch.
- The existing Gemini Files helper is for RAG assets, not CREW blobs. Its poller
  catches failed processing and continues after timeout. Refactor it to fail
  explicitly, honor cancellation, and clean up temporary files before reuse.
- Inline media requests must account for base64 expansion and total request
  size; the upload limit alone is not a safe inline-request limit. Prefer the
  Files API for the pilot.
- Add a scoped reprocessing path for previously failed media, with explicit
  user initiation and organization ownership checks.
- Verify real audio, silent recordings, unreadable frames, corrupt files,
  provider timeouts, missing organization keys, cross-organization access, and
  timestamp citations. Unit mocks do not establish live media quality.

## Primary reference

[Gemini video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
documents native audio/visual analysis, inline and Files API inputs, and
timestamped questions. Consult current provider limits when implementing.
