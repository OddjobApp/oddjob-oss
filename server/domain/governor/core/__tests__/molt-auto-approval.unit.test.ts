import { describe, it, expect } from "vitest";
import { isAutoApprovableSigTool } from "../molt-producer.js";

/**
 * Guards the SIG_USER_ALERT auto-approval allowlist. Auto-approval must stay
 * limited to (a) side-effect-free read-only tools, (b) proposal-only tools
 * whose real action remains human-gated, and (c) pipeline execution tools that
 * perform their own pre-execution validation (nonce, access control, parameter
 * validation). Anything that acts directly without such safeguards (create /
 * update / delete / spend) must NEVER auto-approve — that is the safety
 * boundary the operator relies on.
 */
describe("isAutoApprovableSigTool", () => {
    it("auto-approves read-only lookup tools", () => {
        for (const t of ["google_search", "browse_web", "search_knowledge_graph", "list_documents", "get_entity_details", "list_missions", "get_mission", "list_hil_forms"]) {
            expect(isAutoApprovableSigTool(t)).toBe(true);
        }
    });

    it("auto-approves proposal-only tools (real action stays human-gated by the proposal's own approval)", () => {
        for (const t of ["propose_research_mission", "propose_mission", "propose_mission_synthesis"]) {
            expect(isAutoApprovableSigTool(t)).toBe(true);
        }
    });

    it("auto-approves pipeline execution tools (nonce + access-control validated before SIG_USER_ALERT)", () => {
        for (const t of ["trigger_pipeline", "show_pipeline_input_form", "get_pipeline_status"]) {
            expect(isAutoApprovableSigTool(t)).toBe(true);
        }
    });

    it("does NOT auto-approve state-mutating / executing tools without pre-validation", () => {
        for (const t of [
            "create_job", "update_job", "delete_job",
            "publish_app", "execute_research", "send_email", "move_funds",
        ]) {
            expect(isAutoApprovableSigTool(t)).toBe(false);
        }
    });

    it("is case-sensitive to the lowercased contract (callers lowercase first)", () => {
        // Callers pass an already-lowercased tool name; an upper-case string that
        // isn't an explicit alias must not match.
        expect(isAutoApprovableSigTool("PROPOSE_RESEARCH_MISSION")).toBe(false);
    });
});
