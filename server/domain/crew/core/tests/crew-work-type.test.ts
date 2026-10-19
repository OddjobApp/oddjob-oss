/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { classifyWorkType } from "../crew-work-type.js";

describe("classifyWorkType", () => {
    it("classifies by executed tools, not prose", () => {
        expect(classifyWorkType([{ name: "send_agentmail", ok: true }])).toBe("inbox_briefings");
        expect(classifyWorkType([{ name: "slack_post_message", ok: true }])).toBe("inbox_briefings");
        expect(classifyWorkType([{ name: "github_create_pr" }])).toBe("engineering_product");
        expect(classifyWorkType([{ name: "google_calendar_list" }])).toBe("calendar_meetings");
        expect(classifyWorkType([{ name: "hubspot_search_contacts" }])).toBe("sales_pipeline");
        expect(classifyWorkType([{ name: "generate_word" }])).toBe("research_documents");
        expect(classifyWorkType([{ name: "propose_outbound_message" }])).toBe("inbox_briefings");
    });

    it("a turn claiming research but only sending mail is inbox work", () => {
        expect(classifyWorkType([{ name: "send_email" }], "research")).toBe("inbox_briefings");
    });

    it("falls back to intent when nothing ran", () => {
        expect(classifyWorkType([], "Chat")).toBe("other");
        expect(classifyWorkType(null, "Research")).toBe("research_documents");
    });

    it("other when nothing classifies", () => {
        expect(classifyWorkType([])).toBe("other");
        expect(classifyWorkType(undefined, null)).toBe("other");
    });
});
