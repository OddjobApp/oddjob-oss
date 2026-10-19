/**
 * Blackboard Content Classifier — Unit Tests
 */
import { describe, it, expect } from "vitest";
import { classifyValue } from "../../server/domain/mission/ui/modules/missions/components/blackboard/classifier";

describe("classifyValue — empty", () => {
    it("classifies null", () => expect(classifyValue("k", null).type).toBe("empty"));
    it("classifies undefined", () => expect(classifyValue("k", undefined).type).toBe("empty"));
    it("classifies empty string", () => expect(classifyValue("k", "").type).toBe("empty"));
    it("classifies empty array", () => expect(classifyValue("k", []).type).toBe("empty"));
    it("classifies empty object", () => expect(classifyValue("k", {}).type).toBe("empty"));
});

describe("classifyValue — url_value", () => {
    it("detects plain HTTPS URL", () => expect(classifyValue("link", "https://example.com/page").type).toBe("url_value"));
    it("detects HTTP URL", () => expect(classifyValue("link", "http://localhost:3000").type).toBe("url_value"));
    it("does not match prose with URL inside", () => expect(classifyValue("k", "Visit https://example.com for more info").type).not.toBe("url_value"));
});

describe("classifyValue — error_object", () => {
    it("detects error with message + stack", () => {
        expect(classifyValue("err", { message: "boom", stack: "Error\n  at foo:1" }).type).toBe("error_object");
    });
    it("detects error with name ending in Error", () => {
        expect(classifyValue("err", { message: "bad", name: "TypeError" }).type).toBe("error_object");
    });
    it("does not match plain objects", () => {
        expect(classifyValue("obj", { foo: "bar", baz: 42 }).type).not.toBe("error_object");
    });
});

describe("classifyValue — code_block", () => {
    it("detects TypeScript function", () => {
        const result = classifyValue("output", "const greet = (name: string): string => {\n  return `Hello ${name}`;\n};");
        expect(result.type).toBe("code_block");
        expect(result.metadata.language).toBe("typescript");
    });
    it("detects Python", () => {
        const result = classifyValue("code", "def add(a, b):\n    return a + b\nimport sys");
        expect(result.type).toBe("code_block");
        expect(result.metadata.language).toBe("python");
    });
    it("detects SQL", () => {
        const result = classifyValue("query", "SELECT id, name FROM users WHERE active = true ORDER BY name;");
        expect(result.type).toBe("code_block");
        expect(result.metadata.language).toBe("sql");
    });
    it("detects fenced code block", () => {
        expect(classifyValue("snippet", "```javascript\nconsole.log('hi');\n```").type).toBe("code_block");
    });
    it("does not classify short plain text as code", () => {
        expect(classifyValue("note", "Task completed successfully").type).not.toBe("code_block");
    });
});

describe("classifyValue — markdown_document", () => {
    it("detects multi-section report", () => {
        const md = `# Research Report\n\n## Findings\n\nThe market is growing at **12% YoY**.\n\n- Revenue up\n- Costs stable\n\n## Conclusion\n\nStrong outlook.`;
        const result = classifyValue("result", md);
        expect(result.type).toBe("markdown_document");
    });
    it("does not classify short strings as markdown", () => {
        expect(classifyValue("note", "Short text").type).not.toBe("markdown_document");
    });
    it("gets key-name boost for result key", () => {
        const md = `# Title\n\nSome **bold** text with a [link](https://example.com) and more detail.`;
        const r1 = classifyValue("result", md);
        const r2 = classifyValue("other_key", md);
        expect(r1.confidence).toBeGreaterThanOrEqual(r2.confidence);
    });
});

describe("classifyValue — conversation_thread", () => {
    const thread = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "Help me with X" },
    ];
    it("detects conversation thread", () => expect(classifyValue("messages", thread).type).toBe("conversation_thread"));
    it("does not confuse with timeline", () => {
        const timeline = [{ timestamp: "2026-01-01", event: "start" }, { timestamp: "2026-01-02", event: "end" }];
        expect(classifyValue("events", timeline).type).not.toBe("conversation_thread");
    });
});

describe("classifyValue — timeline_events", () => {
    const events = [
        { timestamp: "2026-05-01T10:00:00Z", event: "step_started", note: "Beginning" },
        { timestamp: "2026-05-01T10:01:00Z", event: "step_done", note: "Finished" },
        { timestamp: "2026-05-01T10:02:00Z", type: "error", note: "Failed" },
    ];
    it("detects timeline events", () => expect(classifyValue("trace", events).type).toBe("timeline_events"));
});

describe("classifyValue — search_results", () => {
    const results = [
        { title: "Result 1", url: "https://example.com/1", snippet: "First result" },
        { title: "Result 2", url: "https://example.com/2", snippet: "Second result" },
        { title: "Result 3", link: "https://example.com/3", description: "Third result" },
    ];
    it("detects search results array", () => expect(classifyValue("search_out", results).type).toBe("search_results"));
});

describe("classifyValue — structured_dataset", () => {
    const dataset = [
        { id: 1, name: "Alice", score: 95, active: true },
        { id: 2, name: "Bob", score: 87, active: false },
        { id: 3, name: "Carol", score: 92, active: true },
        { id: 4, name: "Dave", score: 78, active: true },
    ];
    it("detects uniform tabular data", () => {
        const result = classifyValue("users", dataset);
        expect(result.type).toBe("structured_dataset");
        expect(result.metadata.rowCount).toBe(4);
        expect(result.metadata.columnNames).toContain("name");
    });
    it("does not classify single-item arrays as datasets", () => {
        expect(classifyValue("item", [{ id: 1, name: "Alice" }]).type).not.toBe("structured_dataset");
    });
});

describe("classifyValue — status_scalar", () => {
    it("classifies number", () => expect(classifyValue("cycle", 7).type).toBe("status_scalar"));
    it("classifies boolean", () => expect(classifyValue("active", true).type).toBe("status_scalar"));
    it("classifies short string", () => expect(classifyValue("status", "completed").type).toBe("status_scalar"));
    it("does not classify long strings as scalar", () => {
        expect(classifyValue("text", "a".repeat(150)).type).not.toBe("status_scalar");
    });
});

describe("classifyValue — key_value_map", () => {
    it("detects flat config object", () => {
        const result = classifyValue("config", { provider: "google", model: "gemini-1.5-pro", maxTokens: 1024, temperature: 0.7 });
        expect(result.type).toBe("key_value_map");
    });
    it("does not match single-key objects", () => {
        expect(classifyValue("single", { key: "val" }).type).not.toBe("key_value_map");
    });
});

describe("classifyValue — truncated values", () => {
    it("marks truncated strings", () => {
        const result = classifyValue("result", "[TRUNCATED:5000] # Report\n\n## Section\n\nContent here with **bold** text.");
        expect(result.metadata.isTruncated).toBe(true);
    });
    it("still classifies truncated markdown as markdown_document", () => {
        const result = classifyValue("result", "[TRUNCATED:5000] # Report\n\n## Section\n\nContent with **bold** and [link](https://x.com) text.");
        expect(result.type).toBe("markdown_document");
    });
});

describe("classifyValue — json_tree fallback", () => {
    it("falls back for deeply nested objects", () => {
        const deep = { a: { b: { c: { d: { e: [1, 2, 3] } } } } };
        expect(classifyValue("nested", deep).type).toBe("json_tree");
    });
});
