# Oddjob Assistant (Copilot)

## Feature overview

Oddjob Assistant is the context-aware conversational surface available throughout
the authenticated application. It helps users understand the current screen,
identify likely next actions, plan work, audit evidence, estimate effort, and
execute supported actions behind a confirmation gate.

It combines route, screen, organization, cycle, and recent ephemeral-event context
with intent identification, conversational modes, attachments, approvals, rich
responses, and instant-app assembly.

## User interface and interactions

### Opening and mobile display

- Desktop users open Assistant from global layout controls or the keyboard shortcut.
- Mobile users open it from the Assistant floating action button, including on
  immersive graph screens where normal mobile navigation is suppressed.
- The mobile sheet uses the available viewport and safe-area insets so its composer
  remains visible above browser and operating-system controls.

### Intent-first opening

The first message identifies likely intent instead of showing a generic welcome.
When the prediction/intervention engine has a useful signal, Assistant displays the
likely intent, confidence, and a confirmation question. Without a reliable signal,
it offers screen-specific questions and actions. Predictions are hypotheses: users
can accept, correct, or ignore them.

Ephemeral events improve workstream context but are not required for basic
route-aware behavior. Durable route, organization, and server records remain
authoritative.

### Modes

| Mode | Purpose | Mutation behavior |
|---|---|---|
| Explain | Explain current state or a concept | Read-only |
| Plan | Produce steps and dependencies | Read-only |
| Estimate | Estimate effort, duration, cost, or risk | Read-only |
| Audit | Review evidence, risks, policy, and traceability | Read-only |
| Execute | Use supported tools to change state | Requires preview and confirmation |

On narrow screens, the full mode strip is replaced by a compact active-mode badge.
Tapping the badge opens the mode selector. Users may also ask a question directly
and allow Assistant to infer the appropriate response shape.

Execute mode displays likely targets, tools, risk, verification, and recovery
expectations before confirmation.

### Attachments

Users can select and remove attachments before sending. Uploaded files appear as
chips in the composer and receipts on the sent message.

Supported inputs:

- text and Markdown;
- CSV and JSON;
- XML and BPMN;
- PDF and DOCX;
- common image formats.

Limits:

- maximum 5 files per message;
- maximum 10 MB per file;
- attachment-only messages are supported with a neutral analysis instruction.

CSV and JSON retain structured content. PDF and DOCX text is extracted. Images are
passed to vision-capable providers. Long textual content is truncated before it is
added to a model request.

### Rich responses and instant apps

Assistant renders supported forms, application launch cards, and assembled
instant-app surfaces. An instant-app surface is accepted only when it matches the
response contract and uses registered platform blocks. Attachment prompts always
go to the model and are not intercepted by local instant-app shortcuts.

## Context and intent architecture

Each request can contain:

- active organization;
- current route and derived screen type;
- selected mode;
- active cycle when resolvable;
- recent conversation history;
- bounded intervention, inbox, and cycle-update context;
- evidence/provenance hints;
- execution-confirmation state.

Prediction and question engines may rank plausible intents from this context. The
UI labels a prediction as a likely intent and shows confidence when available. It
must not silently execute an inferred intent or claim unsupported certainty.

## API and data flow

### Upload: `POST /api/agent/upload`

- Requires authentication.
- Accepts multipart field `files`.
- Accepts up to 5 files, with a 10 MB per-file limit.
- Supports the optional `orgId` query parameter for super-admin scoping.
- Returns `id`, `name`, parsed `type`, `size`, and optional `preview`.
- Parsed content is cached for 24 hours with user and organization ownership.

### Chat: `POST /api/agent/chat`

```json
{
  "message": "Review the attached report",
  "attachments": [
    { "id": "cached-file-id", "name": "report.pdf", "type": "text", "size": 12345 }
  ],
  "context": {
    "page": "mission_detail",
    "currentUrl": "/missions/42",
    "mode": "audit",
    "sessionId": "assistant-session-id"
  }
}
```

The client requests server-sent events and supports the JSON fallback. Attachments
owned by another user or organization are excluded from model context.

## Component architecture

- `server/domain/core/ui/components/layout/AgentChatSheet.tsx`: sheet, messages,
  intent opening, modes, attachments, streaming, rich responses, execution preview.
- `server/domain/core/ui/components/layout/Layout.tsx`: desktop/mobile entry points.
- `server/domain/core/ui/hooks/use-intervention-engine.tsx`: ephemeral signals and
  Assistant updates.
- `server/routes/agent-chat.ts`: authenticated upload and chat endpoints.
- `server/domain/agents/agent.service.ts`: attachment preparation and agent loop.
- `server/domain/core/infrastructure/file-parser.service.ts`: file parsing.
- `server/domain/auth/core/embed-profile-cache.ts`: temporary attachment cache.
- `server/domain/ai/core/prompt-service.ts`: tools and behavior contract.

## Security and permissions

- Upload and chat require an authenticated session.
- Organization scope comes from authenticated context; only super-admins may select
  another organization.
- New attachment cache entries are tagged with uploader and organization.
- Attachments from another user or organization are not passed to the model.
- Execute mode does not bypass tool authorization, governance, approvals, or its
  explicit confirmation preview.
- Opaque attachment UUIDs are identifiers, not authorization.

## Error handling and degraded behavior

- Upload validation errors remain in the composer without losing draft text.
- Quota, spending-cap, rate-limit, API-key, network, and timeout errors are
  translated into actionable Assistant messages.
- If embeddings are unavailable, retrieval may use degraded lexical behavior.
- Invalid external credentials or scopes must be corrected in integration settings.
- Instant-app assembly continues to use its validated rich-response contract.

## Responsive requirements

- The mobile sheet fits the visible dynamic viewport.
- Header, messages, mode badge, attachment chips, and composer remain reachable.
- Attachment names truncate instead of expanding composer width.
- Send is enabled with text or an uploaded attachment, and disabled during upload
  or response generation.

## Testing requirements

Current focused coverage includes intent opening, bounded ephemeral context,
organization/screen/mode summaries, instant-app parsing, mobile entry behavior,
Copilot behavior contracts, and file processing.

Recommended E2E coverage:

1. Verify the composer on a narrow mobile viewport.
2. Tap the mode badge and change modes.
3. Upload, remove, and send every attachment category.
4. Attempt more than five files and a file larger than 10 MB.
5. Verify attachment IDs cannot be reused across users or organizations.
6. Send an attachment-only message.
7. Verify Execute still requires confirmation with attachments.
8. Verify provider failures show actionable messages.

## Known constraints

- Attachment storage expires after 24 hours.
- Model text is bounded; Assistant is not lossless document archival.
- Image understanding requires a vision-capable provider/model.
- Intent identification is probabilistic and must remain correctable.
- Provider quota and external authentication are operational configuration concerns.

## Related documentation

- [Copilot Cycle Operations](../copilot-cycle-operations.md)
- [Intervention Engine](./intervention-engine.md)
- AI Agent Enhancements
- Decision Inbox
- [Knowledge System](../core-features/03-knowledge-system.md)
