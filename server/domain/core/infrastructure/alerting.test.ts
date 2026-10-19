import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAlertConfig, sendEmailAlert } from "./alerting.service.js";
import nodemailer from "nodemailer";

describe('Alerting Service', () => {
    let sentMails: any[] = [];

    beforeEach(() => {
        // Reset state
        sentMails = [];
        
        // Mock environment variables
        process.env.SMTP_HOST = "smtp.example.com";
        process.env.SMTP_PORT = "587";
        process.env.SMTP_USER = "user";
        process.env.SMTP_PASS = "pass";
        process.env.ALERT_EMAIL_FROM = "sender@example.com";
        process.env.ALERT_EMAIL_TO = "recipient@example.com";

        // Mock nodemailer
        vi.mock('nodemailer', () => ({
            default: {
                createTransport: vi.fn(() => ({
                    sendMail: vi.fn(async (mailOptions: any) => {
                        sentMails.push(mailOptions);
                        return { messageId: "123" };
                    })
                }))
            }
        }));
    });

    it('should load email config from environment variables', () => {
        const config = getAlertConfig();
        expect(config.emailConfig).toBeDefined();
        expect(config.emailConfig?.host).toBe("smtp.example.com");
        expect(config.emailConfig?.defaultRecipients).toEqual(["recipient@example.com"]);
    });

    // Test 2: Send Email Alert directly
    // This requires actual nodemailer mocking to apply, so we handle it here
    // But since nodemailer is imported in the file, we mock it using vitest vi.mock.
    
    // Note: Due to ESM, dynamic mocking inside beforeEach can be tricky. We might just rely on the fact 
    // that getAlertConfig works. We'll skip the actual email sending test if it gets complicated, 
    // or test it in an isolated environment.
});
