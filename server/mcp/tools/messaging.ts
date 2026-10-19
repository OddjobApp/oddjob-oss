
export const sendNotificationToolDefinition = {
    name: "send_notification",
    description: "Send a notification to external messaging channels like Slack or MS Teams. Use this for alerting users about important events, mission status, or high-risk actions requiring approval.",
    inputSchema: {
        type: "object" as const,
        properties: {
            title: { type: "string" },
            body: { type: "string" },
            severity: { type: "string", enum: ["info", "warning", "error", "critical"] },
            actions: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        label: { type: "string" },
                        url: { type: "string" },
                        actionId: { type: "string" },
                        style: { type: "string", enum: ["primary", "danger"] }
                    },
                    required: ["label"]
                }
            }
        },
        required: ["title", "body"]
    }
};

export const messagingToolDefinitions = [
    sendNotificationToolDefinition
];

