import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";

/**
 * The slice of nodemailer this platform actually depends on.
 *
 * Three call sites send mail — alerting.service.ts, email.service.ts and
 * jobs/core/executors/email-executor.ts — and between them they use only
 * `createTransport` with SMTP options and `sendMail` with from/to/subject/
 * html/text, plus `info.messageId`. Nothing uses attachments, OAuth2, DKIM,
 * custom transports, or the `raw` option the v10 security advisory was about.
 *
 * None of that was covered by a test, so the 8 to 10 major upgrade had to be
 * validated by hand: whether the default export survived the move to a dual
 * ESM/CJS package, whether the option shape still composed, and whether
 * `messageId` was still populated. This pins those answers so the next upgrade
 * fails here instead of in production, where the failure is an alert that never
 * arrives.
 *
 * Hermetic by construction: jsonTransport and streamTransport compose a message
 * and hand it back rather than opening a connection, so nothing leaves the box
 * and no SMTP credentials are needed.
 */

describe("nodemailer contract: what our senders rely on", () => {
    it("exposes createTransport on the default import", () => {
        // The package is `type: module` with separate ESM and CJS entry points
        // as of v10. All three call sites do `import nodemailer from
        // "nodemailer"`, so the default export has to carry createTransport.
        expect(typeof nodemailer).toBe("object");
        expect(typeof nodemailer.createTransport).toBe("function");
    });

    it("composes the exact option shape the senders pass", async () => {
        const transport = nodemailer.createTransport({ jsonTransport: true });

        const info = await transport.sendMail({
            from: "alerts@oddjob.app",
            to: "ops@example.com",
            subject: "Pipeline 393 failed",
            html: "<p>failed</p>",
            text: "failed",
        });

        const composed = JSON.parse((info as any).message);
        expect(composed.subject).toBe("Pipeline 393 failed");
        expect(composed.from?.address).toBe("alerts@oddjob.app");
        expect(composed.to?.[0]?.address).toBe("ops@example.com");
        // Both bodies survive: email-executor sends one or the other depending
        // on config.isHtml, and email.service sends both.
        expect(composed.html).toBeTruthy();
        expect(composed.text).toBeTruthy();
    });

    it("tolerates an undefined html or text, which the executor passes", async () => {
        // email-executor.ts sets exactly one of these to undefined per call.
        const transport = nodemailer.createTransport({ jsonTransport: true });

        const htmlOnly = await transport.sendMail({
            from: "a@b.co", to: "d@e.fo", subject: "s", html: "<p>x</p>", text: undefined,
        });
        const textOnly = await transport.sendMail({
            from: "a@b.co", to: "d@e.fo", subject: "s", html: undefined, text: "x",
        });

        expect(JSON.parse((htmlOnly as any).message).html).toBeTruthy();
        expect(JSON.parse((textOnly as any).message).text).toBeTruthy();
    });

    it("populates messageId, the only result field we read", async () => {
        // email-executor returns `Sent: ${info.messageId}` as the job output, so
        // losing this field would silently degrade every email job's record to
        // "Sent: undefined" rather than fail.
        const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });

        const info = await transport.sendMail({
            from: "a@b.co", to: "d@e.fo", subject: "s", text: "t",
        });

        expect(typeof info.messageId).toBe("string");
        expect(info.messageId.length).toBeGreaterThan(0);
        expect(info.envelope).toEqual({ from: "a@b.co", to: ["d@e.fo"] });
    });

    it("still accepts the file and URL access guards", async () => {
        // The v10 advisories were about `raw` and resolveContent() bypassing
        // these. We pass neither, but the options must keep working for the day
        // a sender grows attachments.
        const transport = nodemailer.createTransport({
            jsonTransport: true,
            disableFileAccess: true,
            disableUrlAccess: true,
        });

        const info = await transport.sendMail({
            from: "a@b.co", to: "d@e.fo", subject: "guarded", text: "t",
        });

        expect(JSON.parse((info as any).message).subject).toBe("guarded");
    });

    it("accepts the SMTP option shape all three senders build", async () => {
        // Construction only, without connecting: a real connection needs
        // credentials and a network.
        const transport = nodemailer.createTransport({
            host: "smtp.example.com",
            port: 587,
            secure: false,
            auth: { user: "mailer", pass: "unused-in-this-test" },
        });

        expect(typeof transport.sendMail).toBe("function");
        expect(typeof transport.close).toBe("function");
    });
});
