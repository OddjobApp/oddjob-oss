import { createHash } from "node:crypto";
import type { MissionEvidenceEvent } from "./mission-evidence-timeline.service.js";

export const missionEvidenceLevels = [
  "contract",
  "integration",
  "staging",
  "production",
  "customer_verified",
] as const;

export type MissionEvidenceLevel = (typeof missionEvidenceLevels)[number];

export interface MissionEvidenceProvenance {
  level: MissionEvidenceLevel;
  environment: string;
  syntheticData: boolean;
  customerVerified: boolean;
  basis: string[];
  claimLimitations: string[];
}

export interface ChainedEvidenceEvent {
  eventId: string;
  sequence: number;
  timestamp: string;
  previousHash: string;
  eventHash: string;
}

export interface MissionEvidenceIntegrityManifest {
  algorithm: "sha256";
  canonicalization: "oddjob.canonical-json.v1";
  genesisHash: string;
  headHash: string;
  eventCount: number;
  chain: ChainedEvidenceEvent[];
}

const GENESIS_HASH = "0".repeat(64);

export function classifyMissionEvidence(
  run: Record<string, unknown> | null | undefined,
  environment = process.env.NODE_ENV || "development",
): MissionEvidenceProvenance {
  const context = asRecord(run?.missionContext);
  const explicitEnvironment = stringValue(context.environment) || environment;
  const demo = Boolean(
    context.goldenPathFixture
      || context.demo
      || context.seeded
      || stringValue(context.source)?.includes("demo")
      || stringValue(run?.name)?.toLowerCase().includes("golden path"),
  );
  const shadow = run?.isShadow === true;
  const customerVerified = context.customerVerified === true;
  const production = explicitEnvironment === "production" && !demo && !shadow;
  const staging = explicitEnvironment === "staging" && !demo;

  // Customer verification is an explicit customer-supplied assertion. The
  // runtime never infers it from successful execution alone.
  const level: MissionEvidenceLevel = customerVerified && production
    ? "customer_verified"
    : production
      ? "production"
      : staging
        ? "staging"
        : "integration";

  const basis = [
    `runtime_environment=${explicitEnvironment}`,
    `demo_or_seeded=${demo}`,
    `shadow_run=${shadow}`,
    `customer_verified=${customerVerified}`,
  ];
  const claimLimitations = [
    !production ? "This bundle is not production-usage evidence." : undefined,
    !customerVerified ? "No customer has verified the outcome or ROI represented by this bundle." : undefined,
    demo ? "The run contains demo, seeded, or synthetic scenario data." : undefined,
    shadow ? "The run is a shadow evaluation and must not be counted as customer workload." : undefined,
  ].filter((value): value is string => Boolean(value));

  return {
    level,
    environment: explicitEnvironment,
    syntheticData: demo || shadow,
    customerVerified,
    basis,
    claimLimitations,
  };
}

export function buildEvidenceIntegrityManifest(
  events: MissionEvidenceEvent[],
): MissionEvidenceIntegrityManifest {
  const chronological = [...events].sort(compareEvidenceEvents);
  let previousHash = GENESIS_HASH;

  const chain = chronological.map((event, sequence) => {
    const eventHash = sha256(canonicalJson({
      previousHash,
      sequence,
      event,
    }));
    const entry = {
      eventId: event.id,
      sequence,
      timestamp: event.timestamp,
      previousHash,
      eventHash,
    };
    previousHash = eventHash;
    return entry;
  });

  return {
    algorithm: "sha256",
    canonicalization: "oddjob.canonical-json.v1",
    genesisHash: GENESIS_HASH,
    headHash: previousHash,
    eventCount: chain.length,
    chain,
  };
}

export function verifyEvidenceIntegrityManifest(
  events: MissionEvidenceEvent[],
  manifest: MissionEvidenceIntegrityManifest,
): boolean {
  const rebuilt = buildEvidenceIntegrityManifest(events);
  return canonicalJson(rebuilt) === canonicalJson(manifest);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)]),
  );
}

function compareEvidenceEvents(left: MissionEvidenceEvent, right: MissionEvidenceEvent): number {
  const timestampDelta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
  if (timestampDelta !== 0) return timestampDelta;
  const sequenceDelta = left.sequence - right.sequence;
  return sequenceDelta !== 0 ? sequenceDelta : left.id.localeCompare(right.id);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}
