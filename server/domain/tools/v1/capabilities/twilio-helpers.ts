export type TwilioConfig = { accountSid: string; authToken: string; fromNumber: string };

export async function getTwilioConfig(orgId?: number | null): Promise<TwilioConfig | null> {
    const envConfig = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
        ? { accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN, fromNumber: process.env.TWILIO_FROM_NUMBER || "" }
        : null;

    if (!orgId) return envConfig;
    try {
        const { db } = await import("@server/database_service.js");
        const { credentials } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [cred] = await db
            .select()
            .from(credentials)
            .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "twilio")))
            .limit(1);
        if (cred?.metadata) return cred.metadata as TwilioConfig;
    } catch {}
    return envConfig;
}

export async function twilioRequest(
    config: Pick<TwilioConfig, "accountSid" | "authToken">,
    path: string,
    body?: Record<string, string>
) {
    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body ? new URLSearchParams(body).toString() : undefined,
    });
    if (!res.ok) throw new Error(`Twilio API error ${res.status}: ${await res.text()}`);
    return res.json();
}
