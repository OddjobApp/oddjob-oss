/**
 * Signal Feed Credentials
 *
 * Keeps feed auth tokens out of `signal_feeds.auth_credentials`.
 *
 * WHY: that column is plain `jsonb`. It held `{ type, token }` in cleartext —
 * readable by anyone with a database handle, present in every backup and every
 * `SELECT *`, and (because the feed routes returned whole rows) served to any
 * org member over `GET /api/signal-feeds`. Meanwhile
 * `encryptedCredentialsService` already provided AES-256-GCM storage for
 * exactly this, and Slack and the SaaS connectors already used it.
 *
 * The column now carries a non-secret descriptor only:
 *   { type: "bearer", storage: "encrypted" }
 * and the token lives in `encrypted_credentials` keyed by feed id.
 *
 * LEGACY ROWS: a feed written before this change still has `{ type, token }`.
 * `resolveFeedCredentials` reads those, so an un-migrated deployment keeps
 * polling, and `server/scripts/migrate-feed-credentials.ts` moves them across.
 */

import { createLogger } from "@server/utils/logger.js";
import { encryptedCredentialsService } from "@domain/auth/core/encrypted-credentials.service.js";
import { isEncryptionAvailable } from "@server/utils/encryption.js";
import { ValidationError } from "@server/utils/errors.js";

const logger = createLogger("FeedCredentials");

/** Entity namespace in `encrypted_credentials`, alongside 'slack_workspace' etc. */
export const FEED_ENTITY_TYPE = "signal_feed";
/** Only one credential per feed today; named so a second kind can be added. */
export const FEED_CREDENTIAL_TYPE = "feed_auth";

export interface FeedAuthCredentials {
  type: string;
  token: string;
}

/** What is safe to persist on the feed row itself. */
export interface FeedCredentialDescriptor {
  type: string;
  storage: "encrypted";
}

/** True if the value is a legacy cleartext `{ type, token }` blob. */
export function isLegacyCleartext(
  value: unknown
): value is FeedAuthCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as any).token === "string" &&
    (value as any).token.length > 0
  );
}

/** True if the feed row points at the encrypted store. */
export function hasStoredCredentials(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as any).storage === "encrypted"
  );
}

/**
 * Encrypt and store a feed's credentials, returning the descriptor to persist
 * on the feed row. Throws if encryption is unconfigured — storing the token in
 * cleartext "for now" is the defect this module exists to remove.
 */
export async function storeFeedCredentials(
  organizationId: number,
  feedId: number,
  credentials: FeedAuthCredentials
): Promise<FeedCredentialDescriptor> {
  if (!isEncryptionAvailable()) {
    throw new ValidationError(
      "Cannot store feed credentials: ENCRYPTION_KEY (or APP_TOKEN_ENCRYPTION_KEY) is not configured. " +
        "Set it, or configure the feed without credentials."
    );
  }

  await encryptedCredentialsService.store(
    organizationId,
    FEED_ENTITY_TYPE,
    feedId,
    FEED_CREDENTIAL_TYPE,
    credentials
  );

  return { type: credentials.type, storage: "encrypted" };
}

/**
 * Resolve the credentials to use when fetching a feed.
 *
 * Returns null when the feed genuinely has no credentials. Throws when it is
 * supposed to have them but they cannot be read — polling on anyway would fetch
 * unauthenticated, which either 401s (recorded as a feed failure with a
 * misleading cause) or quietly returns a public subset of the real feed.
 */
export async function resolveFeedCredentials(feed: {
  id: number;
  organizationId: number;
  authCredentials: unknown;
}): Promise<FeedAuthCredentials | null> {
  const stored = feed.authCredentials;

  if (stored == null) return null;

  if (isLegacyCleartext(stored)) {
    logger.warn(
      `Feed ${feed.id} still stores its token in cleartext on signal_feeds.auth_credentials. ` +
        `Run server/scripts/migrate-feed-credentials.ts to encrypt it.`
    );
    return { type: stored.type, token: stored.token };
  }

  if (!hasStoredCredentials(stored)) return null;

  const credentials = await encryptedCredentialsService.retrieve(
    feed.organizationId,
    FEED_ENTITY_TYPE,
    feed.id,
    FEED_CREDENTIAL_TYPE
  );

  if (!credentials || typeof credentials.token !== "string") {
    throw new Error(
      `Feed ${feed.id} is configured with encrypted credentials, but they could not be decrypted. ` +
        `Check ENCRYPTION_KEY has not changed, or re-enter the feed's credentials.`
    );
  }

  return { type: String(credentials.type ?? "bearer"), token: credentials.token };
}

/** Remove a feed's stored credentials. Called when a feed is deleted. */
export async function deleteFeedCredentials(organizationId: number, feedId: number): Promise<void> {
  await encryptedCredentialsService.delete(
    organizationId,
    FEED_ENTITY_TYPE,
    feedId,
    FEED_CREDENTIAL_TYPE
  );
}

/**
 * Strip anything secret from a feed row before it leaves the process.
 *
 * The feed routes returned whole rows, so `GET /api/signal-feeds` served every
 * stored token to any member of the org. Descriptors are safe to expose (the
 * UI needs to know a feed *has* credentials); tokens never are.
 */
export function redactFeedCredentials<T extends { authCredentials?: unknown }>(
  feed: T
): T {
  const stored = feed.authCredentials;
  if (stored == null) return feed;

  const type =
    typeof stored === "object" && stored !== null
      ? String((stored as any).type ?? "unknown")
      : "unknown";

  return { ...feed, authCredentials: { type, configured: true } };
}
