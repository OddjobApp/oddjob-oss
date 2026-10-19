# Canonical Event Pod

## Purpose
The Canonical Event Pod is responsible for normalizing and classifying raw events from any source into a standard `CanonicalEvent` format. This ensures that the rest of the prediction engine can work with a uniform schema regardless of the source.

## Key Responsibilities
1.  **Normalization**: Mapping source-specific payloads to the canonical schema.
2.  **Validation**: Ensuring events meet the required schema and quality bars.
3.  **Classification**: Determining the event kind (fact, inference, prediction, etc.) and category.
4.  **Redaction**: Stripping sensitive data based on privacy policies.

## Interface
The pod implements the `CanonicalEventPort` interface:

```typescript
export interface CanonicalEventPort {
    canonicalize(input: RawEventEnvelope, ctx: DomainContext): Promise<CanonicalEventResult>;
    validate(input: RawEventEnvelope, ctx: DomainContext): Promise<ValidationReport>;
    normalize(input: RawEventEnvelope, ctx: DomainContext): Promise<Partial<CanonicalEvent>>;
    classifyKind(input: Partial<CanonicalEvent>, ctx: DomainContext): Promise<EventKind>;
    redact(input: Partial<CanonicalEvent>, ctx: DomainContext): Promise<RedactionResult>;
    persist(input: CanonicalEvent, ctx: DomainContext): Promise<CanonicalEvent>;
    correct(input: EventCorrectionInput, ctx: DomainContext): Promise<CanonicalEvent>;
    retract(input: EventRetractionInput, ctx: DomainContext): Promise<CanonicalEvent>;
}
```

## Usage
```typescript
import { canonicalEventService } from "./canonical-event.service.js";

const result = await canonicalEventService.canonicalize(rawEvent, domainCtx);
if (result.accepted) {
    const event = result.event;
    // Proceed to generate quants or store
}
```
