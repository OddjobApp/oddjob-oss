# Blueprint surface requests in CREW

The SDLC workbench SDK exports `requestCrewInput` from `lib/workbench-bridge.ts`. Mounted same-origin surfaces can request a question, a form, or review of an existing governed app-record approval.

```ts
const answer = await requestCrewInput({
  kind: 'form', title: 'Requirements intake',
  fields: [{ key: 'objective', label: 'What outcome is needed?', required: true }],
});
if (answer.status === 'submitted') {
  // Populate a local draft for review. This answer is not approval to execute.
  const objective = answer.data?.objective;
}

const decision = await requestCrewInput({
  kind: 'approval', title: 'Review proposed app change', approvalId: persistedProposalId,
});
// decision.data?.decision is a confirmed persisted approval status,
// not an execution receipt. Do not execute the already-governed action again.
```

Field types: text, number, select and checkbox. Requests accept at most 20 uniquely keyed fields, 30 choices per select and 4,000 characters per text answer. Required fields, finite numbers and allowed choices are validated; unknown answer fields are dropped. React renders labels and values as text.

The host validates message version, origin, mounted iframe and room. IDs deduplicate requests. It acknowledges acceptance, returns submitted answers or cancellation, and rejects stale responses after navigation or canvas replacement. SDK deadlines are five seconds for acknowledgment and fifteen minutes for an answer; callers may pass an AbortSignal. Inputs are transient and cancel on refresh rather than claiming durable recovery.

Approval cards load through `/api/crew/:room/surface-approval/:id`. The server checks room membership, app/project access, designated approver access, and stored app/room provenance. This first implementation supports existing `app_record_action` proposals created through the governed proposal path. A surface cannot invent an approval payload or turn a question answer into authorization. Decisions use the existing approval endpoint; completed decisions replay without a second approval. Other approval kinds require an explicit provenance contract before being enabled here.

Live pilot: PM's “Request requirements in CREW” fills a local requirement draft; Fleet requests a recovery brief; unconnected workbenches request setup input. These input paths neither connect a provider nor launch a mission automatically.
