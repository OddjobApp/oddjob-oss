/**
 * Which agent turns may be written into the manuscript.
 *
 * The old gate was `content.length > 25`, so a room's opening exchange grew
 * three identical "Insert into Station" buttons — on the greeting, on "I'll
 * draft that now", and on the actual draft. The audit read them as duplicates.
 * They were worse: two of the three offered to append chatter to a contract,
 * because the insert takes the turn verbatim.
 *
 * The tests that matter most are the refusals. Refusing a real draft costs a
 * copy-paste; accepting "Certainly! Here you go:" puts it in a signed
 * agreement.
 */

import { describe, expect, it } from "vitest";
import { draftableFrom, hasInsertableDraft } from "./insertable-draft";

const PARAGRAPH =
    "The vendor shall deliver each work package in accordance with the milestone schedule set " +
    "out in Schedule 2, and shall notify the client in writing of any anticipated delay as soon " +
    "as it becomes apparent.";

describe("turns that offer nothing", () => {
    const CHATTER = [
        ["a greeting", "Hello! I'm the Scribe Lead for this room."],
        ["an announcement", "I'll draft the scope section for you now."],
        ["a future-tense announcement", "Let me put together a first pass at the deliverables section."],
        ["a progress note", "Working on the milestone table — one moment."],
        ["a short acknowledgement", "Got it."],
        ["an offer with no content", "Would you like me to draft the acceptance criteria next?"],
        ["an empty turn", ""],
        ["whitespace", "   \n  "],
    ] as const;

    it.each(CHATTER)("refuses %s", (_name, content) => {
        expect(draftableFrom(content)).toBeNull();
        expect(hasInsertableDraft(content)).toBe(false);
    });

    it("refuses a long announcement that never gets to a draft", () => {
        // Length was the entire old gate, and this clears it comfortably.
        const verbose =
            "I'm going to review the framework, check the knowledge base for comparable " +
            "agreements, and then prepare a first draft of the scope section for your review.";

        expect(verbose.length).toBeGreaterThan(120);
        expect(draftableFrom(verbose)).toBeNull();
    });

    it("handles a non-string", () => {
        expect(draftableFrom(null)).toBeNull();
        expect(draftableFrom(undefined)).toBeNull();
        expect(draftableFrom(42 as any)).toBeNull();
    });
});

describe("turns that carry a draft", () => {
    it("takes a bare passage as it stands", () => {
        expect(draftableFrom(PARAGRAPH)).toBe(PARAGRAPH);
    });

    it("drops the handover that introduces it", () => {
        expect(draftableFrom(`Here's the scope section:\n\n${PARAGRAPH}`)).toBe(PARAGRAPH);
        expect(draftableFrom(`Certainly! I've drafted the following:\n\n${PARAGRAPH}`)).toBe(PARAGRAPH);
        expect(draftableFrom(`Sure — below is a first pass:\n\n${PARAGRAPH}`)).toBe(PARAGRAPH);
    });

    it("drops the offer that follows it", () => {
        expect(draftableFrom(`${PARAGRAPH}\n\nLet me know if you'd like it tightened.`)).toBe(PARAGRAPH);
        expect(draftableFrom(`${PARAGRAPH}\n\nWould you like me to add a remedies clause?`)).toBe(PARAGRAPH);
    });

    it("drops both at once", () => {
        const wrapped = `Certainly! Here is the scope section:\n\n${PARAGRAPH}\n\nHappy to revise it.`;
        expect(draftableFrom(wrapped)).toBe(PARAGRAPH);
    });

    it("keeps a colon that belongs to the prose", () => {
        const withColon =
            "The vendor shall provide the following: a monthly service report, a quarterly " +
            "business review, and an annual security attestation covering the preceding twelve months.";

        expect(draftableFrom(withColon)).toBe(withColon);
    });
});

describe("a draft the agent marked itself", () => {
    it("takes the fenced block and nothing around it", () => {
        const turn = `I checked the framework first. Here's my draft:\n\n\`\`\`\n${PARAGRAPH}\n\`\`\`\n\nLet me know what you think.`;
        expect(draftableFrom(turn)).toBe(PARAGRAPH);
    });

    it("takes a fenced block regardless of its language tag", () => {
        expect(draftableFrom(`\`\`\`markdown\n${PARAGRAPH}\n\`\`\``)).toBe(PARAGRAPH);
    });

    it("joins several fenced blocks", () => {
        const two = `\`\`\`\nFirst clause.\n\`\`\`\n\nand\n\n\`\`\`\nSecond clause.\n\`\`\``;
        expect(draftableFrom(two)).toBe("First clause.\n\nSecond clause.");
    });

    it("trusts a short fenced block, since the agent marked it deliberately", () => {
        // The length floor guards against mistaking a remark for a draft. A
        // fence removes the ambiguity, so the floor is not needed.
        expect(draftableFrom("```\nThe Annual Fee is £2.4M.\n```")).toBe("The Annual Fee is £2.4M.");
    });

    it("refuses an empty fence", () => {
        expect(draftableFrom("```\n\n```")).toBeNull();
    });
});

describe("the opening exchange the audit saw", () => {
    it("offers exactly one action across a greeting, an announcement and a draft", () => {
        const turns = [
            "Hello! I'm the Scribe Lead. I'll help you put this Statement of Work together.",
            "Let me draft the scope section based on what you've described.",
            `Here's the scope section:\n\n${PARAGRAPH}`,
        ];

        expect(turns.filter(hasInsertableDraft)).toHaveLength(1);
    });

    it("offered one on every turn under the old length gate", () => {
        // What made them look like duplicates: the only test was length.
        const turns = [
            "Hello! I'm the Scribe Lead. I'll help you put this Statement of Work together.",
            "Let me draft the scope section based on what you've described.",
            `Here's the scope section:\n\n${PARAGRAPH}`,
        ];

        expect(turns.filter((t) => t.length > 25)).toHaveLength(3);
    });
});

describe("supervisor banter and advisory excerpt recommendations", () => {
    it("strips supervisor apologies, room deliberation, and converts advisory bullets to document prose", () => {
        const turn = `My apologies, Supervisor. The prevailing agreement in the room is for **A**: "Before defining specific data entities, we should establish the overall structure and sections of the spec document by adding a Table of Contents (TOC) to the Scribe Studio."

The Analyst's research into "best practices for inventory management PRD table of contents" and their subsequent suggestion to include sections on "data foundations, demand planning, and continuous counting" directly supports the need for an overarching structure before detailing individual entities. This evidence shifts the immediate priority to establishing the document's framework.

Regarding the excerpt from Scribe Station "1. Data Foundations," for the Shelfie PRD, I recommend the following improvements to align with platform architecture and fleet scaling:

*   **Strategic Imperative:** Emphasize how Shelfie supports Acme Corp's strategic goals for operational efficiency, waste reduction, and intelligent inventory management.
*   **Problem Framing:** Frame the problem in terms of current inefficiencies in inventory tracking, potential for spoilage, and the lack of real-time consumption insights that impact resource allocation and potential scaling.
*   **Key Stakeholders:** Clearly identify stakeholders such as Operations, Supply Chain, and IT/Platform teams, highlighting their roles in data integration, system maintenance, and ensuring the scalability of the solution.
*   **Decision Support:** Specify that this document supports decisions related to platform resource allocation, data model design, and the selection of appropriate backend services to ensure Shelfie's long-term viability and performance.

These suggestions will ensure the "Data Foundations" section provides a robust architectural context for the rest of the PRD.`;

        const result = draftableFrom(turn);
        expect(result).not.toBeNull();
        expect(result).not.toContain("My apologies, Supervisor");
        expect(result).not.toContain("The prevailing agreement in the room");
        expect(result).not.toContain("The Analyst's research");
        expect(result).not.toContain("Regarding the excerpt");
        expect(result).not.toContain("These suggestions will ensure");
        // Check normalized prose
        expect(result).toContain("**Strategic Imperative:** Shelfie supports Acme Corp's strategic goals");
        expect(result).toContain("**Problem Framing:** Focuses on current inefficiencies");
        expect(result).toContain("**Key Stakeholders:** Operations, Supply Chain");
        expect(result).toContain("**Decision Support:** Supports decisions related to platform");
    });

    it("accepts concise disclaimers, notices, and confidentiality warnings even under 120 chars", () => {
        const disclaimer = "*Disclaimer: For internal review only and does not constitute formal legal counsel.*";
        expect(disclaimer.length).toBeLessThan(120);
        expect(draftableFrom(disclaimer)).toBe(disclaimer);
        expect(hasInsertableDraft(disclaimer)).toBe(true);

        const notice = "**Notice:** This specification is subject to ongoing architectural changes.";
        expect(notice.length).toBeLessThan(120);
        expect(draftableFrom(notice)).toBe(notice);
        expect(hasInsertableDraft(notice)).toBe(true);

        const confidential = "*Confidentiality Note: Do not distribute outside the engineering steering group.*";
        expect(confidential.length).toBeLessThan(120);
        expect(draftableFrom(confidential)).toBe(confidential);
        expect(hasInsertableDraft(confidential)).toBe(true);
    });
});
