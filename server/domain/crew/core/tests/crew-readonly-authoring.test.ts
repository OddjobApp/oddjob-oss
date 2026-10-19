import { expect, it } from "vitest";
import { isScribeAuthoringRequest, isScribeEditRequest } from "../crew-round-context";
it("keeps read-only app probes out of active-document write routing", () => {
  const message = "Read-only app check: report telemetry. Do not create documents, mount studios, launch missions, approve, or change records.";
  expect(isScribeEditRequest(message, true)).toBe(false);
  expect(isScribeAuthoringRequest(message)).toBe(false);
});
it("honors a negated document creation request without a read-only prefix", () => {
  expect(isScribeEditRequest("Verify the app. Do not create documents.", true)).toBe(false);
  expect(isScribeAuthoringRequest("Do not create a document or mount Scribe Studio.")).toBe(false);
});
it("retains explicit writing requests", () => {
  expect(isScribeEditRequest("Create a document", true)).toBe(true);
  expect(isScribeAuthoringRequest("Create a document")).toBe(true);
});
