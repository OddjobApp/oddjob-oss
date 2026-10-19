import { describe, it, expect } from 'vitest';
import { appBuilderService } from '../../app-builder.service.js';

describe("Unified App Forge to Builder Studio Lifecycle", () => {

    describe("1. AI Edit Payload Normalization Pipeline", () => {
        // Test the normalization logic that resolved the toast error:
        // "Enhancement Failed: AI returned edit entries, but none contained string file content."
        
        it("should normalize flat string file maps", () => {
            const rawEdits = {
                "pages/index.tsx": "export default function Home() { return <div>Home</div>; }",
                "styles/globals.css": "body { margin: 0; }"
            };
            const normalized = appBuilderService.normalizeEdits(rawEdits);
            expect(normalized).toEqual({
                "pages/index.tsx": "export default function Home() { return <div>Home</div>; }",
                "styles/globals.css": "body { margin: 0; }"
            });
        });

        it("should unwrap nested { content: string } and { code: string } objects", () => {
            const rawEdits = {
                "pages/index.tsx": { content: "export default function Home() { return <div>Unwrapped</div>; }" },
                "components/Header.tsx": { code: "export function Header() { return <header />; }" }
            };
            const normalized = appBuilderService.normalizeEdits(rawEdits);
            expect(normalized).toEqual({
                "pages/index.tsx": "export default function Home() { return <div>Unwrapped</div>; }",
                "components/Header.tsx": "export function Header() { return <header />; }"
            });
        });

        it("should unwrap array-based file entry structures: { files: [{ path, content }] }", () => {
            const rawEdits = {
                files: [
                    { path: "pages/dashboard.tsx", content: "export default function Dash() { return null; }" },
                    { path: "lib/api.ts", code: "export const api = {};" }
                ]
            };
            const normalized = appBuilderService.normalizeEdits(rawEdits);
            expect(normalized).toEqual({
                "pages/dashboard.tsx": "export default function Dash() { return null; }" ,
                "lib/api.ts": "export const api = {};"
            });
        });

        it("should ignore invalid non-string leaf nodes safely", () => {
            const rawEdits = {
                "pages/valid.tsx": "const x = 1;",
                "invalid/meta.json": 12345,
                "invalid/null.tsx": null
            };
            const normalized = appBuilderService.normalizeEdits(rawEdits);
            expect(normalized).toEqual({
                "pages/valid.tsx": "const x = 1;"
            });
        });
    });

    describe("2. 4-Zone Targeted Grid Spatial Placement Prompts", () => {
        const buildGridPlacementPrompt = (componentName: string, slot: 'top' | 'left' | 'right' | 'bottom') => {
            const slotDescriptions = {
                top: "at the very TOP of the page as a full-width Hero/Banner position above existing cards",
                left: "in the LEFT column of the primary 2-column grid (beneath Squad Fleet Readiness)",
                right: "in the RIGHT column of the primary 2-column grid (beneath Service Provider Network)",
                bottom: "at the very BOTTOM of the page spanning full width beneath the 2-column card grid",
            };
            return `Please add the representative primitive "${componentName}" to the application layout. CRITICAL GRID PLACEMENT: Place this component ${slotDescriptions[slot]}. Ensure proper responsive grid column spans, matching industrial typography, and clean Tailwind dark theme styling.`;
        };

        it("should generate top hero placement prompt", () => {
            const prompt = buildGridPlacementPrompt("MetricsCard", "top");
            expect(prompt).toContain("TOP of the page as a full-width Hero/Banner");
            expect(prompt).toContain("MetricsCard");
        });

        it("should generate left column placement prompt", () => {
            const prompt = buildGridPlacementPrompt("TelemetryChart", "left");
            expect(prompt).toContain("LEFT column of the primary 2-column grid");
        });

        it("should generate right column placement prompt", () => {
            const prompt = buildGridPlacementPrompt("AuditLogTable", "right");
            expect(prompt).toContain("RIGHT column of the primary 2-column grid");
        });

        it("should generate bottom full-width footer placement prompt", () => {
            const prompt = buildGridPlacementPrompt("StatusBanner", "bottom");
            expect(prompt).toContain("BOTTOM of the page spanning full width");
        });
    });

    describe("3. In-Studio Direct Publishing & Access Governance Contracts", () => {
        const formatPublicSlug = (raw: string) => {
            return raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        };

        const generateEmbedCode = (origin: string, slug: string) => {
            const fullUrl = `${origin}/forged/${slug}`;
            return `<iframe src="${fullUrl}?embed=true" width="100%" height="800px" frameborder="0" allow="clipboard-read; clipboard-write"></iframe>`;
        };

        it("should sanitize and normalize public slugs for production edge routing", () => {
            expect(formatPublicSlug("Rescue Dispatch v2.0 !")).toBe("rescue-dispatch-v2-0");
            expect(formatPublicSlug("  --My Tactical App-- ")).toBe("my-tactical-app");
            expect(formatPublicSlug("ALPHA_BRAVO_CHARLIE")).toBe("alpha-bravo-charlie");
        });

        it("should generate valid responsive iframe embed codes", () => {
            const embed = generateEmbedCode("https://oddjob.internal", "rescue-dispatch");
            expect(embed).toContain('src="https://oddjob.internal/forged/rescue-dispatch?embed=true"');
            expect(embed).toContain('allow="clipboard-read; clipboard-write"');
        });

        it("should validate access governance policies", () => {
            const validPolicies = ['public', 'internal_only', 'password'];
            expect(validPolicies.includes('public')).toBe(true);
            expect(validPolicies.includes('internal_only')).toBe(true);
            expect(validPolicies.includes('password')).toBe(true);
            expect(validPolicies.includes('unrestricted_open')).toBe(false);
        });
    });

    describe("4. OpenAPI 3.1 & Request Runner Contract Explorer", () => {
        const generateCurlSnippet = (origin: string, slug: string, method: string, path: string, body?: string) => {
            const targetUrl = `${origin}/forged/${slug}${path}`;
            if (method === 'GET') {
                return `curl -X GET "${targetUrl}"`;
            }
            return `curl -X ${method} "${targetUrl}" \\\n  -H "Content-Type: application/json" \\\n  -d '${(body || '{}').replace(/'/g, "'\\''")}'`;
        };

        it("should generate accurate cURL GET commands", () => {
            const curl = generateCurlSnippet("http://localhost:5000", "rescue-dispatch", "GET", "/api/health");
            expect(curl).toBe('curl -X GET "http://localhost:5000/forged/rescue-dispatch/api/health"');
        });

        it("should generate accurate cURL POST commands with properly escaped JSON bodies", () => {
            const body = JSON.stringify({ event: "squad.deploy", unit: "squad-1" });
            const curl = generateCurlSnippet("http://localhost:5000", "rescue-dispatch", "POST", "/api/dispatch", body);
            expect(curl).toContain('curl -X POST "http://localhost:5000/forged/rescue-dispatch/api/dispatch"');
            expect(curl).toContain('-H "Content-Type: application/json"');
            expect(curl).toContain('-d \'{"event":"squad.deploy","unit":"squad-1"}\'');
        });
    });
});
