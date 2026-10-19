/**
 * Tests for signal feed credential handling.
 *
 * REGRESSION CONTEXT: `signal_feeds.auth_credentials` is plain jsonb and used to
 * receive `{ type, token }` verbatim from the API. That put feed tokens in
 * cleartext at rest and in every backup, and — because the feed routes returned
 * whole rows — served them to any member of the org over GET /api/signal-feeds.
 *
 * The assertions that matter are the negative ones: no token reaches the row,
 * and no token survives redaction.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const storeMock = vi.fn(async () => ({ id: 1 }));
const retrieveMock = vi.fn(async () => null as any);
const deleteMock = vi.fn(async () => true);
let encryptionAvailable = true;

vi.mock("@domain/auth/core/encrypted-credentials.service.js", () => ({
  encryptedCredentialsService: {
    store: (...args: any[]) => storeMock(...(args as [])),
    retrieve: (...args: any[]) => retrieveMock(...(args as [])),
    delete: (...args: any[]) => deleteMock(...(args as [])),
  },
}));

vi.mock("@server/utils/encryption.js", () => ({
  isEncryptionAvailable: () => encryptionAvailable,
}));

import {
  storeFeedCredentials,
  resolveFeedCredentials,
  redactFeedCredentials,
  isLegacyCleartext,
  hasStoredCredentials,
  FEED_ENTITY_TYPE,
  FEED_CREDENTIAL_TYPE,
} from "./feed-credentials.service.js";

describe("feed credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encryptionAvailable = true;
    retrieveMock.mockResolvedValue(null);
  });

  describe("storeFeedCredentials", () => {
    it("returns a descriptor that carries no token", async () => {
      const descriptor = await storeFeedCredentials(7, 42, {
        type: "bearer",
        token: "super-secret-value",
      });

      expect(descriptor).toEqual({ type: "bearer", storage: "encrypted" });
      expect(JSON.stringify(descriptor)).not.toContain("super-secret-value");
    });

    it("hands the token to the encrypted store keyed by feed id", async () => {
      await storeFeedCredentials(7, 42, { type: "bearer", token: "tok" });

      expect(storeMock).toHaveBeenCalledWith(
        7,
        FEED_ENTITY_TYPE,
        42,
        FEED_CREDENTIAL_TYPE,
        { type: "bearer", token: "tok" }
      );
    });

    it("refuses to store when encryption is unconfigured", async () => {
      encryptionAvailable = false;

      await expect(
        storeFeedCredentials(7, 42, { type: "bearer", token: "tok" })
      ).rejects.toThrow(/ENCRYPTION_KEY/);
      expect(storeMock).not.toHaveBeenCalled();
    });
  });

  describe("resolveFeedCredentials", () => {
    it("returns null for a feed with no credentials", async () => {
      const result = await resolveFeedCredentials({ id: 1, organizationId: 7, authCredentials: null });
      expect(result).toBeNull();
      expect(retrieveMock).not.toHaveBeenCalled();
    });

    it("decrypts credentials for a descriptor-backed feed", async () => {
      retrieveMock.mockResolvedValue({ type: "bearer", token: "decrypted-token" });

      const result = await resolveFeedCredentials({
        id: 42,
        organizationId: 7,
        authCredentials: { type: "bearer", storage: "encrypted" },
      });

      expect(result).toEqual({ type: "bearer", token: "decrypted-token" });
      expect(retrieveMock).toHaveBeenCalledWith(
        7,
        FEED_ENTITY_TYPE,
        42,
        FEED_CREDENTIAL_TYPE
      );
    });

    it("still honours a legacy cleartext row so un-migrated feeds keep polling", async () => {
      const result = await resolveFeedCredentials({
        id: 3,
        organizationId: 7,
        authCredentials: { type: "basic", token: "legacy-token" },
      });

      expect(result).toEqual({ type: "basic", token: "legacy-token" });
      expect(retrieveMock).not.toHaveBeenCalled();
    });

    it("throws rather than polling unauthenticated when decryption fails", async () => {
      retrieveMock.mockResolvedValue(null);

      await expect(
        resolveFeedCredentials({
          id: 42,
          organizationId: 7,
          authCredentials: { type: "bearer", storage: "encrypted" },
        })
      ).rejects.toThrow(/could not be decrypted/);
    });
  });

  describe("redactFeedCredentials", () => {
    it("strips the token from a legacy row", () => {
      const redacted = redactFeedCredentials({
        id: 3,
        name: "feed",
        authCredentials: { type: "basic", token: "legacy-token" },
      });

      expect(JSON.stringify(redacted)).not.toContain("legacy-token");
      expect(redacted.authCredentials).toEqual({ type: "basic", configured: true });
    });

    it("preserves the absence of credentials", () => {
      const redacted = redactFeedCredentials({ id: 3, authCredentials: null });
      expect(redacted.authCredentials).toBeNull();
    });

    it("keeps other feed fields intact", () => {
      const redacted = redactFeedCredentials({
        id: 3,
        name: "feed",
        url: "https://example.com",
        authCredentials: { type: "bearer", storage: "encrypted" },
      } as any);

      expect(redacted).toMatchObject({ id: 3, name: "feed", url: "https://example.com" });
    });
  });

  describe("shape predicates", () => {
    it("distinguishes legacy cleartext from a descriptor", () => {
      expect(isLegacyCleartext({ type: "bearer", token: "t" })).toBe(true);
      expect(isLegacyCleartext({ type: "bearer", storage: "encrypted" })).toBe(false);
      expect(isLegacyCleartext(null)).toBe(false);

      expect(hasStoredCredentials({ type: "bearer", storage: "encrypted" })).toBe(true);
      expect(hasStoredCredentials({ type: "bearer", token: "t" })).toBe(false);
    });
  });
});
