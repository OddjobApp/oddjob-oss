import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateKeyPairSync, sign as cryptoSign, createHmac } from "node:crypto";

import { BotFrameworkJwtVerifier, BOT_FRAMEWORK_OPENID_CONFIG } from "./bot-framework-jwt.js";
import { TeamsAdapter } from "./teams.adapter.js";

/**
 * The Teams adapter accepted any request carrying an Authorization header, so
 * a forged activity was processed as genuine. These tests sign with real RSA
 * keys and cover each way JWT verification is normally defeated: an `alg: none`
 * token, an HS256 swap that tries to use the public key as an HMAC secret, a
 * key the JWKS never published, a token for a different bot, and an expired
 * one.
 */

const ISSUER = "https://api.botframework.com";
const APP_ID = "11111111-2222-3333-4444-555555555555";
const JWKS_URI = "https://login.botframework.com/v1/.well-known/keys";

function b64url(input: Buffer | string): string {
    return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function rsaKey(kid: string) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as any;
    return { kid, privateKey, publicKey, jwk: { ...jwk, kid, alg: "RS256", use: "sig" } };
}

function makeToken(
    key: ReturnType<typeof rsaKey>,
    claims: Record<string, unknown>,
    header: Record<string, unknown> = {},
): string {
    const h = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.kid, ...header }));
    const p = b64url(JSON.stringify(claims));
    const sig = cryptoSign("RSA-SHA256", Buffer.from(`${h}.${p}`, "utf8"), key.privateKey);
    return `${h}.${p}.${b64url(sig)}`;
}

/** A fetch stub serving the metadata document and the JWKS. */
function jwksFetch(keys: any[], opts: { configStatus?: number; jwksUri?: string } = {}) {
    return vi.fn(async (url: any) => {
        const u = String(url);
        if (u === BOT_FRAMEWORK_OPENID_CONFIG) {
            if (opts.configStatus && opts.configStatus !== 200) {
                return new Response("nope", { status: opts.configStatus });
            }
            return new Response(JSON.stringify({ jwks_uri: opts.jwksUri ?? JWKS_URI }), { status: 200 });
        }
        if (u === (opts.jwksUri ?? JWKS_URI)) {
            return new Response(JSON.stringify({ keys }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
    }) as any;
}

const NOW_MS = 1_760_000_000_000;
const nowSeconds = Math.floor(NOW_MS / 1000);
const validClaims = () => ({
    iss: ISSUER,
    aud: APP_ID,
    exp: nowSeconds + 600,
    nbf: nowSeconds - 10,
    serviceUrl: "https://smba.trafficmanager.net/emea/",
});

describe("BotFrameworkJwtVerifier", () => {
    let key: ReturnType<typeof rsaKey>;

    beforeEach(() => {
        key = rsaKey("kid-current");
    });

    function verifier(fetchImpl: any) {
        return new BotFrameworkJwtVerifier({ fetchImpl, now: () => NOW_MS });
    }

    it("accepts an activity signed by a published key", async () => {
        const v = verifier(jwksFetch([key.jwk]));
        const result = await v.verify(`Bearer ${makeToken(key, validClaims())}`, APP_ID);

        expect(result.issuer).toBe(ISSUER);
        expect(result.audience).toBe(APP_ID);
        expect(result.serviceUrl).toBe("https://smba.trafficmanager.net/emea/");
    });

    it("rejects a token whose payload was altered after signing", async () => {
        const v = verifier(jwksFetch([key.jwk]));
        const token = makeToken(key, validClaims());
        const [h, , s] = token.split(".");
        const forged = `${h}.${b64url(JSON.stringify({ ...validClaims(), aud: APP_ID, sub: "attacker" }))}.${s}`;

        await expect(v.verify(`Bearer ${forged}`, APP_ID)).rejects.toThrow(/signature does not match/i);
    });

    it("rejects alg: none, without consulting the JWKS", async () => {
        const fetchImpl = jwksFetch([key.jwk]);
        const v = verifier(fetchImpl);
        const h = b64url(JSON.stringify({ alg: "none", typ: "JWT", kid: key.kid }));
        const p = b64url(JSON.stringify(validClaims()));

        await expect(v.verify(`Bearer ${h}.${p}.`, APP_ID)).rejects.toThrow(/Unsupported token algorithm/i);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("rejects an HS256 token signed with the public key as the secret", async () => {
        // The classic algorithm-confusion attack: if the verifier trusted the
        // header's alg it would treat the published public key as an HMAC
        // secret, which the attacker also has.
        const v = verifier(jwksFetch([key.jwk]));
        const pubPem = key.publicKey.export({ format: "pem", type: "spki" }).toString();
        const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: key.kid }));
        const p = b64url(JSON.stringify(validClaims()));
        const mac = createHmac("sha256", pubPem).update(`${h}.${p}`).digest();

        await expect(v.verify(`Bearer ${h}.${p}.${b64url(mac)}`, APP_ID)).rejects.toThrow(
            /Unsupported token algorithm/i,
        );
    });

    it("rejects a token signed by a key the JWKS never published", async () => {
        const attacker = rsaKey("kid-current"); // same kid, different key material
        const v = verifier(jwksFetch([key.jwk]));

        await expect(v.verify(`Bearer ${makeToken(attacker, validClaims())}`, APP_ID)).rejects.toThrow(
            /signature does not match/i,
        );
    });

    it("rejects an unknown key id rather than trusting the token", async () => {
        const stranger = rsaKey("kid-not-published");
        const v = verifier(jwksFetch([key.jwk]));

        await expect(v.verify(`Bearer ${makeToken(stranger, validClaims())}`, APP_ID)).rejects.toThrow(
            /No Bot Framework signing key published/i,
        );
    });

    it("rejects a valid token issued for a different bot", async () => {
        const v = verifier(jwksFetch([key.jwk]));
        const token = makeToken(key, { ...validClaims(), aud: "99999999-0000-0000-0000-000000000000" });

        await expect(v.verify(`Bearer ${token}`, APP_ID)).rejects.toThrow(/audience does not match/i);
    });

    it("rejects a foreign issuer", async () => {
        const v = verifier(jwksFetch([key.jwk]));
        const token = makeToken(key, { ...validClaims(), iss: "https://evil.example" });

        await expect(v.verify(`Bearer ${token}`, APP_ID)).rejects.toThrow(/not a Bot Framework issuer/i);
    });

    it("rejects an expired token and one that is not yet valid", async () => {
        const v = verifier(jwksFetch([key.jwk]));

        await expect(
            v.verify(`Bearer ${makeToken(key, { ...validClaims(), exp: nowSeconds - 3600 })}`, APP_ID),
        ).rejects.toThrow(/expired/i);

        await expect(
            v.verify(`Bearer ${makeToken(key, { ...validClaims(), nbf: nowSeconds + 3600 })}`, APP_ID),
        ).rejects.toThrow(/not valid yet/i);
    });

    it("rejects a token with no expiry", async () => {
        const v = verifier(jwksFetch([key.jwk]));
        const { exp: _drop, ...rest } = validClaims();

        await expect(v.verify(`Bearer ${makeToken(key, rest)}`, APP_ID)).rejects.toThrow(/no expiry/i);
    });

    it("accepts an aud array that contains the app id", async () => {
        const v = verifier(jwksFetch([key.jwk]));
        const token = makeToken(key, { ...validClaims(), aud: ["other-bot", APP_ID] });

        await expect(v.verify(`Bearer ${token}`, APP_ID)).resolves.toMatchObject({ audience: APP_ID });
    });

    it("refuses when no app id is configured, rather than skipping the audience check", async () => {
        const v = verifier(jwksFetch([key.jwk]));

        await expect(v.verify(`Bearer ${makeToken(key, validClaims())}`, "")).rejects.toThrow(
            /No bot app id configured/i,
        );
    });

    it("rejects a non-Bearer Authorization header and a malformed JWT", async () => {
        const v = verifier(jwksFetch([key.jwk]));

        await expect(v.verify("Basic dXNlcjpwYXNz", APP_ID)).rejects.toThrow(/not a Bearer token/i);
        await expect(v.verify("Bearer not.a.jwt.at.all", APP_ID)).rejects.toThrow(/three-part JWT/i);
    });

    it("refuses to follow a non-HTTPS jwks_uri", async () => {
        const v = verifier(jwksFetch([key.jwk], { jwksUri: "http://attacker.example/keys" }));

        await expect(v.verify(`Bearer ${makeToken(key, validClaims())}`, APP_ID)).rejects.toThrow(
            /non-HTTPS jwks_uri/i,
        );
    });

    it("surfaces a metadata fetch failure instead of passing", async () => {
        const v = verifier(jwksFetch([key.jwk], { configStatus: 503 }));

        await expect(v.verify(`Bearer ${makeToken(key, validClaims())}`, APP_ID)).rejects.toThrow(
            /HTTP 503/,
        );
    });

    it("caches the JWKS instead of fetching per request", async () => {
        const fetchImpl = jwksFetch([key.jwk]);
        const v = verifier(fetchImpl);
        const auth = `Bearer ${makeToken(key, validClaims())}`;

        await v.verify(auth, APP_ID);
        await v.verify(auth, APP_ID);
        await v.verify(auth, APP_ID);

        // One metadata fetch plus one JWKS fetch, not three of each.
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("does not re-fetch on every unknown key id", async () => {
        // Otherwise a stream of invented kids becomes a stream of outbound
        // requests to Microsoft.
        const fetchImpl = jwksFetch([key.jwk]);
        const v = verifier(fetchImpl);
        await v.verify(`Bearer ${makeToken(key, validClaims())}`, APP_ID);
        const afterWarm = fetchImpl.mock.calls.length;

        for (let i = 0; i < 5; i++) {
            const stranger = rsaKey(`kid-invented-${i}`);
            await expect(
                v.verify(`Bearer ${makeToken(stranger, validClaims())}`, APP_ID),
            ).rejects.toThrow(/No Bot Framework signing key published/i);
        }

        expect(fetchImpl.mock.calls.length).toBe(afterWarm);
    });
});

describe("TeamsAdapter.verifyWebhook", () => {
    const key = rsaKey("kid-teams");
    const fetchImpl = jwksFetch([key.jwk]);
    const makeVerifier = () => new BotFrameworkJwtVerifier({ fetchImpl, now: () => NOW_MS });

    it("accepts a genuine activity", async () => {
        const adapter = new TeamsAdapter(APP_ID, "secret", undefined, makeVerifier());

        await expect(
            adapter.verifyWebhook({ authorization: `Bearer ${makeToken(key, validClaims())}` }, "{}"),
        ).resolves.toBe(true);
    });

    it("rejects a forged activity", async () => {
        const attacker = rsaKey("kid-teams");
        const adapter = new TeamsAdapter(APP_ID, "secret", undefined, makeVerifier());

        await expect(
            adapter.verifyWebhook({ authorization: `Bearer ${makeToken(attacker, validClaims())}` }, "{}"),
        ).rejects.toThrow(/Teams JWT verification failed/i);
    });

    it("still refuses a request with no Authorization header", async () => {
        const adapter = new TeamsAdapter(APP_ID, "secret", undefined, makeVerifier());

        await expect(adapter.verifyWebhook({}, "{}")).rejects.toThrow(/Missing Authorization header/i);
    });

    it("pins the AAD tenant when one is configured", async () => {
        const adapter = new TeamsAdapter(APP_ID, "secret", "tenant-ours", makeVerifier());

        await expect(
            adapter.verifyWebhook(
                { authorization: `Bearer ${makeToken(key, { ...validClaims(), tid: "tenant-ours" })}` },
                "{}",
            ),
        ).resolves.toBe(true);

        await expect(
            adapter.verifyWebhook(
                { authorization: `Bearer ${makeToken(key, { ...validClaims(), tid: "tenant-theirs" })}` },
                "{}",
            ),
        ).rejects.toThrow(/tenant tenant-theirs/i);
    });

    it("passes unverified only when no app id is configured", async () => {
        const adapter = new TeamsAdapter("", "secret", undefined, makeVerifier());

        await expect(adapter.verifyWebhook({ authorization: "Bearer anything" }, "{}")).resolves.toBe(true);
    });
});
