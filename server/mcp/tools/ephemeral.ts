
import { z } from "zod";

export const GetUserIntentInput = z.object({
    fingerprint: z.string().describe("The user's unique browser fingerprint (f_id)"),
});

export const ephemeralToolDefinitions = [
    {
        name: "get_user_intent",
        description: "Get the real-time cognitive state (S.C.O.R.E.) and engagement history for a specific user.",
        inputSchema: GetUserIntentInput,
    },
];

