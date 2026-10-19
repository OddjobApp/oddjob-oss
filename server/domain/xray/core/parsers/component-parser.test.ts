import { describe, it, expect } from "vitest";
import {
  parseComponentFile,
  isBarrelFile,
  extractParentDir,
} from "./component-parser.js";

describe("component-parser", () => {
  describe("isBarrelFile", () => {
    it("returns true for file with only named re-exports", () => {
      const content = `export { Button } from "./button";\nexport { Input } from "./input";\n`;
      expect(isBarrelFile(content)).toBe(true);
    });

    it("returns true for file with star re-exports", () => {
      const content = `export * from "./button";\nexport * from "./input";\n`;
      expect(isBarrelFile(content)).toBe(true);
    });

    it("returns true for file with default re-exports", () => {
      const content = `export { default } from "./button";\n`;
      expect(isBarrelFile(content)).toBe(true);
    });

    it("returns false for file with actual component code", () => {
      const content = `import React from "react";\nexport const Button = () => <button />;\n`;
      expect(isBarrelFile(content)).toBe(false);
    });

    it("returns false for empty file", () => {
      expect(isBarrelFile("")).toBe(false);
    });

    it("ignores comments when determining barrel status", () => {
      const content = `// Re-exports for barrel\nexport { Button } from "./button";\n`;
      expect(isBarrelFile(content)).toBe(true);
    });

    it("returns true for mixed named and star re-exports", () => {
      const content = `export * from "./utils";\nexport { Card } from "./card";\n`;
      expect(isBarrelFile(content)).toBe(true);
    });

    it("returns false when file has import + re-export", () => {
      const content = `import { something } from "./other";\nexport { Button } from "./button";\n`;
      expect(isBarrelFile(content)).toBe(false);
    });
  });

  describe("extractParentDir", () => {
    it("extracts parent from standard component path", () => {
      expect(extractParentDir("client/src/components/ui/button.tsx")).toBe("ui");
    });

    it("extracts parent from nested component path", () => {
      expect(
        extractParentDir("client/src/components/admin/forms/Input.tsx")
      ).toBe("admin");
    });

    it("handles Windows-style paths", () => {
      expect(
        extractParentDir("client\\src\\components\\agent-builder\\Panel.tsx")
      ).toBe("agent-builder");
    });

    it("falls back to parent directory name if no components/ in path", () => {
      expect(extractParentDir("some/other/path/MyComponent.tsx")).toBe("path");
    });
  });

  describe("parseComponentFile", () => {
    it("extracts named default export function", () => {
      const content = `import React from "react";\nexport default function MyButton() { return <button />; }\n`;
      const result = parseComponentFile(content, "client/src/components/ui/my-button.tsx", "ui");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("MyButton");
      expect(result!.isDefault).toBe(true);
      expect(result!.parentDir).toBe("ui");
      expect(result!.imports).toContain("react");
    });

    it("extracts named const export", () => {
      const content = `import React from "react";\nexport const DataTable = () => { return <table />; }\n`;
      const result = parseComponentFile(content, "client/src/components/ui/data-table.tsx", "ui");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("DataTable");
      expect(result!.isDefault).toBe(false);
    });

    it("extracts reference default export (export default ComponentName)", () => {
      const content = `import React from "react";\nconst CardView = () => <div />;\nexport default CardView;\n`;
      const result = parseComponentFile(content, "client/src/components/ui/card-view.tsx", "ui");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("CardView");
      expect(result!.isDefault).toBe(true);
    });

    it("uses filename for anonymous default export", () => {
      const content = `import React from "react";\nexport default function() { return <div />; }\n`;
      const result = parseComponentFile(content, "client/src/components/ui/panel.tsx", "ui");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("Panel");
      expect(result!.isDefault).toBe(true);
    });

    it("uses filename for arrow function default export", () => {
      const content = `import React from "react";\nexport default () => <div />;\n`;
      const result = parseComponentFile(content, "client/src/components/admin/sidebar.tsx", "admin");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("Sidebar");
      expect(result!.isDefault).toBe(true);
      expect(result!.parentDir).toBe("admin");
    });

    it("returns null for barrel files", () => {
      const content = `export { Button } from "./button";\nexport { Input } from "./input";\n`;
      const result = parseComponentFile(content, "client/src/components/ui/index.ts", "ui");
      expect(result).toBeNull();
    });

    it("returns null for files with no PascalCase exports", () => {
      const content = `export const helper = () => "hello";\nexport const utils = {};\n`;
      const result = parseComponentFile(content, "client/src/components/ui/helpers.ts", "ui");
      expect(result).toBeNull();
    });

    it("extracts all import specifiers", () => {
      const content = `import React from "react";\nimport { cn } from "@/lib/utils";\nimport { Button } from "../button";\nexport const Card = () => <div />;\n`;
      const result = parseComponentFile(content, "client/src/components/ui/card.tsx", "ui");

      expect(result).not.toBeNull();
      expect(result!.imports).toEqual(["react", "@/lib/utils", "../button"]);
    });

    it("handles forwardRef wrapped default export", () => {
      const content = `import React from "react";\nexport default forwardRef((props, ref) => <input ref={ref} />);\n`;
      const result = parseComponentFile(content, "client/src/components/ui/text-input.tsx", "ui");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("Text-input");
      expect(result!.isDefault).toBe(true);
    });

    it("prefers default export name over named exports", () => {
      const content = `import React from "react";\nexport default function MainPanel() { return <div />; }\nexport const SubPanel = () => <div />;\n`;
      const result = parseComponentFile(content, "client/src/components/admin/main-panel.tsx", "admin");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("MainPanel");
      expect(result!.isDefault).toBe(true);
    });

    it("handles named function export", () => {
      const content = `import React from "react";\nexport function Sidebar() { return <nav />; }\n`;
      const result = parseComponentFile(content, "client/src/components/ui/sidebar.tsx", "ui");

      expect(result).not.toBeNull();
      expect(result!.name).toBe("Sidebar");
      expect(result!.isDefault).toBe(false);
    });

    it("returns null for non-PascalCase named default exports with no other exports", () => {
      const content = `export default function helper() { return "util"; }\n`;
      const result = parseComponentFile(content, "client/src/components/ui/helper.ts", "ui");

      // "helper" is not PascalCase, no named PascalCase exports exist, and
      // this is a named function (not anonymous), so it doesn't trigger the anonymous fallback.
      // Per requirement 3.8: exclude non-component utility files
      expect(result).toBeNull();
    });
  });
});
