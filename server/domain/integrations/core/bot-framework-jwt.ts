import { createPublicKey, verify as cryptoVerify } from "node:crypto";

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BotFrameworkJwt");

/**
 * Validates the JWT Microsoft's Bot Framework puts on every inbound Teams
 * activity.
 *
 * The adapter used to accept any request that merely carried an Authorization
 * header, so a forged activity naming any conversation was processed as
 * genuine. There is no JWT library in this tree, so this verifies directly with
 * node:crypto — which is safe here only because of the rules below, each of
 * which is a known way JWT verification goes wrong:
 *
 *  - The algorithm comes from the JWKS key, never from the token header. A
 *    token that says `alg: none`, or that swaps RS256 for HS256 to get the
 *    public key treated as an HMAC secret, is rejected before any crypto runs.
 *  - Only a key published at the Bot Framework's own JWKS endpoint, matched by
 *    `kid`, can validate a token. A key embedded in the token is ignored.
 *  - Issuer and audience are checked, not just the signature. A validly signed
 *    token issued for a different bot is still not ours.
 *  - Expiry and not-before are enforced with a bounded clock skew.
 *
 * The OpenID metadata document is fetched rather than hardcoded because
 * Microsoft rotates both the signing keys and the `jwks_uri`.
 */

/** Where the Bot Framework publishes its OpenID metadata. */
export const BOT_FRAMEWORK_OPENID_CONFIG =
    "https://login.botframework.com/v1/.well-known/openidconfiguration";

/** The only issuer a channel-originated activity may carry. */
export const BOT_FRAMEWORK_ISSUERS = [
    "https://api.botframework.com",
] as const;

const ALLOWED_ALG = "RS256";
const CLOCK_SKEW_SECONDS = 300;
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;
/** A failed refresh is not retried more often than this, so an unknown `kid` cannot be used to hammer Microsoft. */
const JWKS_REFRESH_FLOOR_MS = 60 * 1000;

interface Jwk {
    kid?: string;
    kty?: string;
    alg?: string;
    use?: string;
    n?: string;
    e?: string;
}

export interface BotFrameworkJwtDeps {
    /** Injected for tests; defaults to global fetch. */
    fetchImpl?: typeof fetch;
    /** Injected for tests; defaults to Date.now. */
    now?: () => number;
    openIdConfigUrl?: string;
}

export interface VerifiedActivityToken {
    /** The `aud` claim, which for a channel request is the bot's app id. */
    audience: string;
    issuer: string;
    /** `serviceUrl` claim when present — Bot Framework includes it for channel requests. */
    serviceUrl?: string;
    claims: Record<string, unknown>;
}

export class BotFrameworkTokenError extends Error {}

function decodeSegment(segment: string): any {
    const json = Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
}

export class BotFrameworkJwtVerifier {
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => number;
    private readonly openIdConfigUrl: string;

    private keys = new Map<string, Jwk>();
    private keysFetchedAt = 0;
    private lastRefreshAttempt = 0;
    private inFlight: Promise<void> | null = null;

    constructor(deps: BotFrameworkJwtDeps = {}) {
        this.fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
        this.now = deps.now ?? (() => Date.now());
        this.openIdConfigUrl = deps.openIdConfigUrl ?? BOT_FRAMEWORK_OPENID_CONFIG;
    }

    /** Drops the cached JWKS. Used by tests and on key rotation. */
    reset(): void {
        this.keys.clear();
        this.keysFetchedAt = 0;
        this.lastRefreshAttempt = 0;
    }

    /**
     * Verifies a bearer token and returns its claims.
     *
     * @param authorization the raw Authorization header value
     * @param expectedAudience the bot's app id; a token for another bot is refused
     */
    async verify(authorization: string, expectedAudience: string): Promise<VerifiedActivityToken> {
        if (!expectedAudience) {
            throw new BotFrameworkTokenError("No bot app id configured; a Teams activity cannot be verified.");
        }

        const token = /^Bearer\s+(.+)$/i.exec(authorization.trim())?.[1];
        if (!token) {
            throw new BotFrameworkTokenError("Authorization header is not a Bearer token.");
        }

        const parts = token.split(".");
        if (parts.length !== 3) {
            throw new BotFrameworkTokenError("Bearer token is not a three-part JWT.");
        }
        const [headerSeg, payloadSeg, signatureSeg] = parts;

        let header: { alg?: string; kid?: string };
        let claims: Record<string, unknown>;
        try {
            header = decodeSegment(headerSeg);
            claims = decodeSegment(payloadSeg);
        } catch {
            throw new BotFrameworkTokenError("Bearer token header or payload is not valid base64url JSON.");
        }

        // Reject on the header's own claim before fetching anything: `none` and
        // an HS* swap are both refused here, and the real algorithm is taken
        // from the JWKS key below regardless of what this says.
        if (header.alg !== ALLOWED_ALG) {
            throw new BotFrameworkTokenError(`Unsupported token algorithm "${header.alg}"; only ${ALLOWED_ALG} is accepted.`);
        }
        if (!header.kid) {
            throw new BotFrameworkTokenError("Token header carries no key id.");
        }

        const jwk = await this.resolveKey(header.kid);
        if (!jwk) {
            throw new BotFrameworkTokenError(`No Bot Framework signing key published for key id "${header.kid}".`);
        }
        if (jwk.kty !== "RSA") {
            throw new BotFrameworkTokenError(`Signing key "${header.kid}" is not an RSA key.`);
        }
        if (jwk.alg && jwk.alg !== ALLOWED_ALG) {
            throw new BotFrameworkTokenError(`Signing key "${header.kid}" is published for ${jwk.alg}, not ${ALLOWED_ALG}.`);
        }

        let signatureValid = false;
        try {
            const key = createPublicKey({ key: jwk as any, format: "jwk" });
            signatureValid = cryptoVerify(
                "RSA-SHA256",
                Buffer.from(`${headerSeg}.${payloadSeg}`, "utf8"),
                key,
                Buffer.from(signatureSeg.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
            );
        } catch (error: any) {
            // A key or signature we cannot process is a rejection, never a pass.
            throw new BotFrameworkTokenError(`Token signature could not be verified: ${error?.message ?? error}`);
        }
        if (!signatureValid) {
            throw new BotFrameworkTokenError("Token signature does not match the published Bot Framework key.");
        }

        // Signature is good; the token is genuinely Microsoft's. It still has to
        // be for us, and current.
        const issuer = String(claims.iss ?? "");
        if (!BOT_FRAMEWORK_ISSUERS.includes(issuer as any)) {
            throw new BotFrameworkTokenError(`Token issuer "${issuer}" is not a Bot Framework issuer.`);
        }

        const audiences = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud ?? "")];
        if (!audiences.includes(expectedAudience)) {
            throw new BotFrameworkTokenError("Token audience does not match this bot's app id.");
        }

        const nowSeconds = Math.floor(this.now() / 1000);
        const exp = Number(claims.exp);
        if (!Number.isFinite(exp)) {
            throw new BotFrameworkTokenError("Token carries no expiry.");
        }
        if (nowSeconds > exp + CLOCK_SKEW_SECONDS) {
            throw new BotFrameworkTokenError("Token has expired.");
        }
        const nbf = Number(claims.nbf);
        if (Number.isFinite(nbf) && nowSeconds + CLOCK_SKEW_SECONDS < nbf) {
            throw new BotFrameworkTokenError("Token is not valid yet.");
        }

        return {
            audience: expectedAudience,
            issuer,
            serviceUrl: typeof claims.serviceUrl === "string" ? claims.serviceUrl : undefined,
            claims,
        };
    }

    /**
     * Returns the published key for a `kid`, refreshing the JWKS when the id is
     * unknown or the cache is stale. Microsoft rotates keys, so an unknown id is
     * an expected event rather than an error — but the refresh is rate limited
     * so a stream of invented ids cannot turn into a stream of outbound
     * requests.
     */
    private async resolveKey(kid: string): Promise<Jwk | undefined> {
        const fresh = this.now() - this.keysFetchedAt < JWKS_TTL_MS;
        if (fresh && this.keys.has(kid)) return this.keys.get(kid);

        const sinceAttempt = this.now() - this.lastRefreshAttempt;
        if (!fresh || !this.keys.has(kid)) {
            if (sinceAttempt >= JWKS_REFRESH_FLOOR_MS || this.keysFetchedAt === 0) {
                await this.refresh();
            }
        }
        return this.keys.get(kid);
    }

    /** Fetches the metadata document and then the JWKS it points at. */
    private async refresh(): Promise<void> {
        if (this.inFlight) return this.inFlight;

        this.lastRefreshAttempt = this.now();
        this.inFlight = (async () => {
            const configRes = await this.fetchImpl(this.openIdConfigUrl, {
                signal: AbortSignal.timeout(10_000),
            });
            if (!configRes.ok) {
                throw new BotFrameworkTokenError(
                    `Bot Framework OpenID metadata returned HTTP ${configRes.status}.`,
                );
            }
            const config = (await configRes.json()) as { jwks_uri?: string };
            const jwksUri = config?.jwks_uri;
            if (!jwksUri) {
                throw new BotFrameworkTokenError("Bot Framework OpenID metadata carries no jwks_uri.");
            }
            // The metadata document is Microsoft's, but it is still remote input:
            // refuse to follow it anywhere but HTTPS.
            if (!jwksUri.startsWith("https://")) {
                throw new BotFrameworkTokenError(`Refusing a non-HTTPS jwks_uri: ${jwksUri}`);
            }

            const jwksRes = await this.fetchImpl(jwksUri, { signal: AbortSignal.timeout(10_000) });
            if (!jwksRes.ok) {
                throw new BotFrameworkTokenError(`Bot Framework JWKS returned HTTP ${jwksRes.status}.`);
            }
            const jwks = (await jwksRes.json()) as { keys?: Jwk[] };
            const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
            if (keys.length === 0) {
                throw new BotFrameworkTokenError("Bot Framework JWKS published no keys.");
            }

            const next = new Map<string, Jwk>();
            for (const key of keys) {
                if (key?.kid) next.set(key.kid, key);
            }
            this.keys = next;
            this.keysFetchedAt = this.now();
            logger.info(`[BotFrameworkJwt] Cached ${next.size} Bot Framework signing key(s).`);
        })().finally(() => {
            this.inFlight = null;
        });

        return this.inFlight;
    }
}

export const botFrameworkJwtVerifier = new BotFrameworkJwtVerifier();
