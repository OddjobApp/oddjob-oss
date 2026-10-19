# Rescue Dispatch Functional Specification

> X-Ray scope: `rescue-dispatch`  
> Verification source: `tests/e2e/rescue-dispatch-end-to-end.spec.ts`

## Purpose

Rescue Dispatch coordinates a dual-sided service workflow between a requester, an operations dispatcher, and a field provider. This specification records user-visible behavior supported by the linked Playwright E2E suite. “Verified” means the behavior has an explicit assertion in the suite; it does not imply that the test has passed in the current workspace unless a test result is cited separately.

## Actors and interfaces

| Actor | Interface | Route |
| --- | --- | --- |
| Requester | Rescue Dispatch AI chat and intake | `/a/rescue-dispatcher` |
| Operations dispatcher | Rescue Dispatch control portal | `/app/rescue-dispatch` |
| Field provider | Provider mission workspace | `/h/demo-token` |

## Functional flows

### FS-RD-01 — Requester intake and maintenance verification

Evidence status: **Verified by assertions**

Behavior ID: `rescue-dispatch.requester.intake-and-maintenance-verification`

1. The requester opens the Rescue Dispatcher chat.
2. The interface accepts a problem statement.
3. A dispatch problem causes the structured intake form to appear.
4. The requester can select a geocoded address and enter an asset serial number, target equipment, incident details, incident type, and priority.
5. Selecting **Run Pipeline** submits the intake through the public Rescue Dispatcher chat endpoint.
6. A successful response returns a canonical numeric rescue session ID.
7. The requester interface presents service-dispatch tracking.
8. The created session can be retrieved from `/api/rescue/sessions/:sessionId`.
9. The interface displays the asset’s active, verified maintenance-contract status.

Acceptance evidence: `DEMO-01`.

### FS-RD-02 — Operations request inspection

Evidence status: **Verified by assertions**

Behavior ID: `rescue-dispatch.operations.request-inspection`

1. A rescue created by requester intake appears in the operations portal using its canonical `RSC-###` identifier.
2. The dispatcher can focus the matching request.
3. Request details display the rescue identifier and submitted asset serial number.
4. Request details display the active, verified maintenance-contract state.
5. The operations app must not render an unavailable-app or missing-file error.

Acceptance evidence: `DEMO-02`.

### FS-RD-03 — Accept, deploy, and track

Evidence status: **Partially verified**

Behavior ID: `rescue-dispatch.operations.accept-deploy-and-track`

1. A second requester intake can create an urgent equipment-recovery dispatch.
2. The resulting rescue becomes visible in the operations portal.
3. The operations interface exposes optional **Accept & Track**, squad deployment, and provider-marker interactions when those controls are available.
4. The user can return to the requester view after operations activity.

Only rescue creation, requester tracking, and request visibility are asserted. Accept, deploy, provider inspection, and the final en-route map are currently exercised or captured in screenshots but are not asserted; those steps remain **Observed**, not fully verified.

Acceptance evidence: `DEMO-03`.

### FS-RD-04 — Provider optimization, Copilot, and mission acceptance

Evidence status: **Verified by assertions**

Behavior ID: `rescue-dispatch.provider.optimize-and-accept-missions`

1. The provider workspace identifies the assigned provider as **Apex Field Response**.
2. Route optimization is available as an explicit provider action.
3. A governed AI Copilot is available.
4. The provider can query the Copilot for asset specifications using serial number `GEN-8842-X`.
5. The Copilot response includes the serial number and verified maintenance information.
6. Mission acceptance is an explicit provider action.
7. The operations portal exposes active-rescue capacity information.

Acceptance evidence: `DEMO-04`.

## Traceability

```text
Rescue Dispatch app/blueprint
  COVERS -> UI behavior contract
    VERIFIED_BY -> Playwright E2E test
```

X-Ray discovers this relationship from `@xray-scope rescue-dispatch` and the stable `@behavior` marker inside each test. Generated app-level X-Ray documentation can therefore retain the source file, starting line, routes, assertions, behavior ID, specification path, and evidence status.

## Known specification gaps

- The suite does not assert validation errors or invalid intake submissions.
- Authorization differences among requester, dispatcher, and provider are not asserted.
- Accept/deploy state transitions and the requester en-route map need explicit assertions.
- Retry, failure, timeout, cancellation, and reassignment flows are not covered.
- A current passing execution result is not stored in this document.
