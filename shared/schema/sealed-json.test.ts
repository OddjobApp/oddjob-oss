/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { encrypt, decrypt } from "../../server/utils/encryption.js";
import { openJsonValue, registerSealedJsonCodec, sealJsonValue, SEALED_KEY } from "./sealed-json.js";
import { saasConnectors } from "./integrations.js";

/**
 * SaaS connector credentials are encrypted at rest, in the format the Python
 * sidecar also reads and writes (backend/core/sealed.py). PY_UNBOUND was sealed
 * by the sidecar with the test key; backend/tests/test_sealed.py opens Node's.
 */
const KEY = "0123456789abcdef".repeat(4);
const PY_UNBOUND = "v3.4884fdaa.u.97c74263f111d15a665b1033.106a2d9d7d2b455d13c1c2494ebf7f1f.5814996c444afaf46aa0379eda737345e6efba7580864b7e4c";

describe("sealed jsonb", () => {
    beforeEach(() => {
        vi.stubEnv("ENCRYPTION_KEY", KEY);
        vi.stubEnv("ENCRYPTION_KEYS_PREVIOUS", "");
        registerSealedJsonCodec({ seal: (p) => encrypt(p), open: (c) => decrypt(c) });
    });
    afterEach(() => vi.unstubAllEnvs());

    it("opens what the Python sidecar sealed", () => {
        expect(openJsonValue({ [SEALED_KEY]: PY_UNBOUND })).toEqual({ api_key: "from-python" });
    });

    it("stores no secret in the clear, and reads it back", () => {
        const stored = sealJsonValue({ api_key: "jira-secret", username: "ops@example.com" });
        expect(Object.keys(stored)).toEqual([SEALED_KEY]);
        expect(JSON.stringify(stored)).not.toContain("jira-secret");
        expect(openJsonValue(stored)).toEqual({ api_key: "jira-secret", username: "ops@example.com" });
    });

    it("still reads a row written before sealing", () => {
        expect(openJsonValue({ api_key: "legacy" })).toEqual({ api_key: "legacy" });
        expect(openJsonValue('{"api_key":"legacy"}')).toEqual({ api_key: "legacy" });
        expect(openJsonValue(null)).toEqual({});
    });

    it("seals the credentials column through Drizzle's driver mapping", () => {
        const column = getTableConfig(saasConnectors).columns.find((c) => c.name === "credentials")!;
        expect(column.getSQLType()).toBe("jsonb");
        const driverValue = column.mapToDriverValue({ access_token: "t0ken" }) as string;
        expect(driverValue).not.toContain("t0ken");
        expect(column.mapFromDriverValue(JSON.parse(driverValue))).toEqual({ access_token: "t0ken" });
    });
});
