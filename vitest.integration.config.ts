import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";

// CLI positional arguments are substring filters, not include globs. Giving
// them '**/integration/**' selected zero files while reporting a successful list.
export default defineConfig({
    ...baseConfig,
    test: {
        ...baseConfig.test,
        include: ["**/integration/**/*.test.{ts,tsx}", "**/*.integration.test.{ts,tsx}"],
        // Names the file behind each unhandled rejection (they arrive without a message or stack).
        setupFiles: [...((baseConfig.test?.setupFiles as string[] | undefined) ?? []), "./tests/unhandled-rejection-reporter.ts"],
        exclude: [...(baseConfig.test?.exclude || []), "external/**", "workspace/**"],
    },
});
