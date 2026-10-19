import { describe, it, expect } from "vitest";
import { mapCodeNodeLabel, isDomainLabel } from "./code-label-mapper.js";

describe("mapCodeNodeLabel", () => {
  describe("file-level nodes map onto the admin UI's vocabulary", () => {
    it.each([
      ["shared/schema/missions/core.ts", "Schema_Model"],
      ["server/domain/mission/routes/missions.route.ts", "API_Route"],
      ["server/routes/xray-intelligence.ts", "API_Route"],
      ["server/routes/auth.controller.ts", "API_Route"],
      ["server/domain/apps/core/app-forge.service.ts", "Service"],
      ["server/domain/admin/ui/modules/admin/pages/SystemKnowledgeGraph.tsx", "Page"],
      ["client/src/components/signal-intelligence/SignalDashboard.tsx", "Component"],
      ["server/domain/xray/infrastructure/workspace-watcher.ts", "Infrastructure"],
    ])("%s → %s", (filePath, expected) => {
      expect(mapCodeNodeLabel("code_file", filePath)).toBe(expected);
    });

    it("falls back to code_file for paths matching no rule", () => {
      expect(mapCodeNodeLabel("code_file", "server/utils/logger.ts")).toBe("code_file");
    });
  });

  describe("rule ordering", () => {
    it("prefers schema over service for a schema file named like a service", () => {
      // Both rules could match; the schema location is the more specific fact.
      expect(mapCodeNodeLabel("code_file", "shared/schema/foo.service.ts")).toBe("Schema_Model");
    });

    it("prefers route over service for a *.route.ts under a service tree", () => {
      expect(
        mapCodeNodeLabel("code_file", "server/domain/mission/routes/missions.route.ts"),
      ).toBe("API_Route");
    });

    it("prefers Page over Component for a page inside a ui tree", () => {
      expect(
        mapCodeNodeLabel("code_file", "server/domain/auth/ui/modules/auth/pages/AuthPage.tsx"),
      ).toBe("Page");
    });
  });

  describe("symbol-level nodes keep their structural kind", () => {
    it.each(["code_function", "code_class", "code_interface", "code_method"] as const)(
      "%s is preserved even inside a service file",
      (kind) => {
        // Labelling every function in a service file as "Service" would produce
        // many nodes each claiming to be the service itself.
        expect(mapCodeNodeLabel(kind, "server/domain/apps/core/app-forge.service.ts")).toBe(kind);
      },
    );
  });

  describe("extracted API routes", () => {
    it("maps to API_Route regardless of host file", () => {
      expect(
        mapCodeNodeLabel("code_function", "server/domain/misc/whatever.ts", { type: "api_route" }),
      ).toBe("API_Route");
    });

    it("takes precedence over the structural-kind passthrough", () => {
      expect(
        mapCodeNodeLabel("code_function", "server/utils/helper.ts", { type: "api_route" }),
      ).toBe("API_Route");
    });
  });

  it("accepts windows-separated paths", () => {
    expect(mapCodeNodeLabel("code_file", "shared\\schema\\missions\\core.ts")).toBe("Schema_Model");
  });
});

describe("isDomainLabel", () => {
  it("recognises curated domain labels", () => {
    expect(isDomainLabel("Service")).toBe(true);
    expect(isDomainLabel("API_Route")).toBe(true);
  });

  it("rejects structural kinds", () => {
    expect(isDomainLabel("code_function")).toBe(false);
    expect(isDomainLabel("code_file")).toBe(false);
  });
});
