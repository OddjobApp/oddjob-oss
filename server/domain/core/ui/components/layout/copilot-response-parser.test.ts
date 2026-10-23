import { describe, expect, it } from "vitest";
import { parseAssistantRichResponse } from "./copilot-response-parser";

describe("parseAssistantRichResponse", () => {
  it("reads an intent clarification as a card, not prose", () => {
    // The shape agent.service returns, nested FormAgent payload included: the
    // sheet showed this verbatim because no branch recognised it.
    const content = JSON.stringify({
      type: "intent_clarification",
      questionId: "gqe_div_1",
      headline: "How would you like to proceed with knowledge_store?",
      question: 'I detected multiple possible intents for "check". Which action best matches your goal?',
      options: [
        { label: "Explain & Summarize", value: "explain", prompt: "Explain knowledge_store." },
        { label: "Audit & Find Blockers", value: "audit", prompt: "Audit knowledge_store." },
      ],
      structuredPayload: { formAgentPayload: { type: "FormAgent", fields: [{ id: "x", type: "select" }] } },
    });

    const rich = parseAssistantRichResponse(content);
    expect(rich?.type).toBe("intent_clarification");
    expect(rich?.type === "intent_clarification" && rich.data.options).toHaveLength(2);
  });

  it("does not treat a payload without a question as a clarification", () => {
    expect(parseAssistantRichResponse(JSON.stringify({ type: "intent_clarification", options: [] }))).toBeNull();
  });
});
