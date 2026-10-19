import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateNodeContent } = vi.hoisted(() => ({ updateNodeContent: vi.fn() }));
vi.mock("@domain/scribe/core/scribe.service.js", () => ({ scribeService: { updateNodeContent } }));

import { SCRIBE_TOOLS } from "@domain/tools/v1/capabilities/scribe.js";

/**
 * scribe_update_node sends the text the turn last read as expectedContent, and
 * the service refuses the write if the station no longer holds it. The turn's
 * own write has to count as a read, or a second edit to the same station is
 * refused as "changed after it was read".
 */
describe("scribe_update_node read tracking", () => {
    const provenanceOf = (call: number) => updateNodeContent.mock.calls[call][7];

    beforeEach(() => {
        updateNodeContent.mockReset();
    });

    it("expects its own earlier write on a second edit to the same station", async () => {
        updateNodeContent
            .mockResolvedValueOnce({ id: 5, stationKey: "intro", content: "first edit", wordCount: 2, status: "draft" })
            .mockResolvedValueOnce({ id: 5, stationKey: "intro", content: "second edit", wordCount: 2, status: "draft" });
        const context: any = { organizationId: 7, scribeReadContents: { 5: "original" } };

        await SCRIBE_TOOLS.scribe_update_node.execute({ nodeId: 5, content: "first edit" }, context);
        await SCRIBE_TOOLS.scribe_update_node.execute({ nodeId: 5, content: "second edit" }, context);

        expect(provenanceOf(0).expectedContent).toBe("original");
        expect(provenanceOf(1).expectedContent).toBe("first edit");
    });

    it("leaves a failed write out of what the turn has read", async () => {
        updateNodeContent.mockRejectedValueOnce(new Error("The section changed after it was read."));
        const context: any = { organizationId: 7, scribeReadContents: { 5: "original" } };

        const output = await SCRIBE_TOOLS.scribe_update_node.execute({ nodeId: 5, content: "rewrite" }, context);

        expect(output).toContain("Error updating Scribe station");
        expect(context.scribeReadContents[5]).toBe("original");
    });

    it("does not invent a read when the turn never read the document", async () => {
        updateNodeContent.mockResolvedValueOnce({ id: 5, stationKey: "intro", content: "draft", wordCount: 1, status: "draft" });
        const context: any = { organizationId: 7 };

        await SCRIBE_TOOLS.scribe_update_node.execute({ nodeId: 5, content: "draft" }, context);

        expect(provenanceOf(0).expectedContent).toBeUndefined();
        expect(context.scribeReadContents).toBeUndefined();
    });
});
