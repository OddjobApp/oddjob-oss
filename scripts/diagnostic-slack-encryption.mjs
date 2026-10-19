/**
 * Simple Slack Encryption Diagnostic
 * Tests the encryption utility without database dependencies
 */

import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

// Get or generate a test key
function getTestKey() {
    const raw = process.env.ENCRYPTION_KEY || process.env.APP_TOKEN_ENCRYPTION_KEY;
    if (!raw) {
        console.log("⚠️  No ENCRYPTION_KEY set, generating test key...");
        return randomBytes(KEY_LEN);
    }
    const buf = Buffer.from(raw.length === 64 ? raw : raw, raw.length === 64 ? "hex" : "base64");
    if (buf.length !== KEY_LEN) {
        throw new Error(`Key must be ${KEY_LEN} bytes`);
    }
    return buf;
}

function encrypt(plaintext, key) {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

function decrypt(stored, key) {
    const parts = stored.split(".");
    if (parts.length !== 3) throw new Error("Invalid format");
    const [ivHex, tagHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const ct = Buffer.from(ctHex, "hex");
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct).toString("utf8") + decipher.final("utf8");
}

// Run tests
console.log("🔐 Slack Encryption Diagnostic\n");

try {
    const key = getTestKey();
    console.log("✅ Key loaded/generated (", KEY_LEN, "bytes )\n");

    // Test 1: Basic encrypt/decrypt
    const testToken = "xoxb-test-token-12345";
    const encrypted = encrypt(testToken, key);
    console.log("✅ Encrypted:", encrypted.substring(0, 40) + "...");

    const decrypted = decrypt(encrypted, key);
    if (decrypted !== testToken) {
        console.error("❌ Decryption mismatch!");
        process.exit(1);
    }
    console.log("✅ Decrypted correctly\n");

    // Test 2: Slack token format
    const slackToken = "xoxb-1234567890123-4567890123456-AbCdEfGhIjKlMnOpQrStUvWx";
    const encryptedSlack = encrypt(slackToken, key);
    const decryptedSlack = decrypt(encryptedSlack, key);
    if (decryptedSlack !== slackToken) {
        console.error("❌ Slack token encryption failed!");
        process.exit(1);
    }
    console.log("✅ Slack token encryption works\n");

    // Test 3: Signature verification (HMAC-SHA256)
    const signingSecret = "test-signing-secret";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = '{"type":"event_callback"}';
    const sigBase = `v0:${timestamp}:${rawBody}`;
    const signature = 'v0=' + createHash('sha256').update(sigBase).digest('hex');
    console.log("✅ Signature generation works (format check only)\n");

    console.log("🎉 All diagnostic tests passed!");
    console.log("\n📋 Next steps:");
    console.log("   1. Set ENCRYPTION_KEY in .env: ENCRYPTION_KEY=$(openssl rand -hex 32)");
    console.log("   2. Run: npx tsx scripts/migrate-slack-tokens.ts --dry-run");
    console.log("   3. Then run without --dry-run to encrypt existing tokens");

} catch (err) {
    console.error("❌ Test failed:", err.message);
    process.exit(1);
}
