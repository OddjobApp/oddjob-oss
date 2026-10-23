/** @vitest-environment node */
import {beforeEach, describe, expect, it, vi} from "vitest";
const status=vi.hoisted(()=>vi.fn());
vi.mock("./org-model.service.js",()=>({orgModelService:{status}}));
import {buildOrgAiReadinessContext} from "./org-ai-readiness-context";
beforeEach(()=>{ status.mockReset(); });
describe("Copilot organization AI readiness",()=>{
 it("uses the active organization's provider without exposing credential metadata",async()=>{
  status.mockResolvedValue({configured:true,provider:"bedrock",model:"amazon.nova-lite-v1:0",keyHint:"SECRET_HINT",connections:[{apiKey:"SECRET_KEY"}]});
  const prompt=await buildOrgAiReadinessContext(7);
  expect(status).toHaveBeenCalledWith(7);
  expect(prompt).toContain("Status: configured");
  expect(prompt).toContain("bedrock");
  expect(prompt).toContain("Do not ask for API keys");
  expect(prompt).not.toContain("SECRET");
  expect(prompt).toContain("does not prove current quota");
 });
 it("offers setup only when this organization is unconfigured",async()=>{
  status.mockResolvedValue({configured:false});
  expect(await buildOrgAiReadinessContext(8)).toContain("Status: not configured");
  expect(status).toHaveBeenCalledWith(8);
 });
 it("does not mistake a lookup failure for missing keys",async()=>{
  status.mockRejectedValue(new Error("SECRET database unavailable"));
  const prompt=await buildOrgAiReadinessContext(7);
  expect(prompt).toContain("Status: unknown");
  expect(prompt).not.toContain("SECRET");
  expect(prompt).not.toContain("Status: not configured");
 });
 it.each([null,undefined,0,-1,NaN,1.5])("rejects invalid scope %s",async id=>{
  expect(await buildOrgAiReadinessContext(id)).toContain("Status: unknown");
  expect(status).not.toHaveBeenCalled();
 });
});
