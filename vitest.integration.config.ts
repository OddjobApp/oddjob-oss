import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config";

// CLI positional arguments are substring filters, not include globs. Giving
// them '**/integration/**' selected zero files while reporting a successful list.
export default defineConfig({
    ...baseConfig,
    test: {
        ...baseConfig.test,
        include: ["**/integration/**/*.test.{ts,tsx}", "**/*.integration.test.{ts,tsx}"],
        exclude: [...(baseConfig.test?.exclude || []), "external/**", "workspace/**"],
    },
});
