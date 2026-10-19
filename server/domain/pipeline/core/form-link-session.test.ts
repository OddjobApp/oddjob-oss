/** @vitest-environment node */
import { beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { signFormSession, verifyFormSession } from "./form-link-session.js";

beforeAll(() => {
    process.env.JWT_SECRET ??= "test-secret-for-form-sessions";
});

const token = "a".repeat(48);

describe("form link sessions", () => {
    it("verifies a session for the link and email it was made for", () => {
        const session = signFormSession({ token, email: "respondent@example.com" });
        expect(verifyFormSession(session, token)).toEqual({ email: "respondent@example.com" });
    });

    it("refuses a session for another link, a missing one, or a tampered one", () => {
        const session = signFormSession({ token, email: "respondent@example.com" });
        expect(verifyFormSession(session, "b".repeat(48))).toBeNull();
        expect(verifyFormSession(null, token)).toBeNull();
        expect(verifyFormSession(`${session}x`, token)).toBeNull();
    });

    it("refuses another kind of token signed with the same secret", () => {
        const external = jwt.sign({ token, email: "respondent@example.com", formId: 1 }, process.env.JWT_SECRET!);
        expect(verifyFormSession(external, token)).toBeNull();
    });

    it("refuses an expired session", () => {
        const expired = jwt.sign({ kind: "form_link", token, email: "respondent@example.com" }, process.env.JWT_SECRET!, { expiresIn: -1 });
        expect(verifyFormSession(expired, token)).toBeNull();
    });
});
