
import { createLogger } from '@server/utils/logger.js';

const logger = createLogger("FingerprintManagerService");

// Data pools for generating realistic fingerprints
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/125.0",
];

const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
];

const GPU_VENDORS = [
    "Google Inc. (NVIDIA)",
    "Google Inc. (AMD)",
    "Google Inc. (Intel)",
    "Apple Inc.",
];

export interface BrowserFingerprint {
    userAgent: string;
    viewport: { width: number; height: number };
    gpuVendor: string;
    language: string;
    platform: string;
}

class FingerprintManagerService {
    /**
     * Generates a new, randomized browser fingerprint.
     */
    public generateFingerprint(): BrowserFingerprint {
        const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        const platform = userAgent.includes('Macintosh') ? 'MacIntel' : 'Win32';

        const fingerprint: BrowserFingerprint = {
            userAgent,
            viewport: VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)],
            gpuVendor: GPU_VENDORS[Math.floor(Math.random() * GPU_VENDORS.length)],
            language: 'en-US',
            platform,
        };

        logger.info("Generated new browser fingerprint.");
        return fingerprint;
    }
}

export const fingerprintManagerService = new FingerprintManagerService();
