import { describe, it, expect, beforeEach } from "vitest";
import { SlackAdapter } from "../core/slack.adapter.js";
import type { ChannelMessage } from "../core/channel-gateway.types.js";

describe("SlackAdapter", () => {
    let adapter: SlackAdapter;

    beforeEach(() => {
        adapter = new SlackAdapter("", ""); // no credentials = stub mode
    });

    describe("parseInbound", () => {
        it("returns null for url_verification type events", () => {
            expect(adapter.parseInbound({ type: "url_verification", challenge: "123" })).toBeNull();
        });

        it("returns null if payload has no event object", () => {
            expect(adapter.parseInbound({ type: "event_callback" })).toBeNull();
        });

        it("returns null for bot messages", () => {
            const payload = {
                type: "event_callback",
                event: {
                    type: "message",
                    bot_id: "B123",
                    text: "hello",
                },
            };
            expect(adapter.parseInbound(payload)).toBeNull();
        });

        it("parses a simple user message", () => {
            const payload = {
                type: "event_callback",
                event_id: "evt-123",
                event: {
                    type: "message",
                    user: "U999",
                    channel: "C111",
                    text: "run pipeline 'deploy'",
                    event_ts: "1719878400.000100",
                },
            };
            const msg = adapter.parseInbound(payload) as ChannelMessage;
            expect(msg).not.toBeNull();
            expect(msg.platform).toBe("slack");
            expect(msg.senderId).toBe("U999");
            expect(msg.channelId).toBe("C111");
            expect(msg.text).toBe("run pipeline 'deploy'");
        });

        it("strips user mentions from text", () => {
            const payload = {
                type: "event_callback",
                event: {
                    type: "message",
                    user: "U999",
                    channel: "C111",
                    text: "<@UABC123> run mission 'sync'",
                },
            };
            const msg = adapter.parseInbound(payload) as ChannelMessage;
            expect(msg).not.toBeNull();
            expect(msg.text).toBe("run mission 'sync'");
        });
    });

    describe("verifyWebhook", () => {
        it("throws when x-slack-signature is missing", () => {
            expect(() => adapter.verifyWebhook({ "x-slack-request-timestamp": "123" }, "body")).toThrow(
                "Missing Slack signature headers."
            );
        });

        it("throws when x-slack-request-timestamp is missing", () => {
            expect(() => adapter.verifyWebhook({ "x-slack-signature": "123" }, "body")).toThrow(
                "Missing Slack signature headers."
            );
        });

        it("throws when request timestamp is too old", () => {
            const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
            expect(() =>
                adapter.verifyWebhook(
                    {
                        "x-slack-signature": "sig",
                        "x-slack-request-timestamp": oldTimestamp.toString(),
                    },
                    "body"
                )
            ).toThrow("Replay attack suspected: request timestamp too old.");
        });

        it("returns true in stub mode when signingSecret is missing", () => {
            const currentTimestamp = Math.floor(Date.now() / 1000).toString();
            const result = adapter.verifyWebhook(
                {
                    "x-slack-signature": "sig",
                    "x-slack-request-timestamp": currentTimestamp,
                },
                "body"
            );
            expect(result).toBe(true);
        });
    });

    describe("sendResponse — stub mode", () => {
        it("does not throw when credentials are missing", async () => {
            await expect(
                adapter.sendResponse({
                    platform: "slack",
                    channelId: "C111",
                    text: "Hello Slack!",
                })
            ).resolves.not.toThrow();
        });
    });
});
