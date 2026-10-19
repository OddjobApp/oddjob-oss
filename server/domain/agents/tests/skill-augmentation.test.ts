import { describe, it, expect } from "vitest";
import { SkillAugmentationService } from "../core/skill-augmentation.service.js";

describe("SkillAugmentationService Logic", () => {
    it("exports augmentAgentCard and rollbackAugmentation functions", () => {
        expect(typeof SkillAugmentationService.augmentAgentCard).toBe("function");
        expect(typeof SkillAugmentationService.rollbackAugmentation).toBe("function");
        expect(typeof SkillAugmentationService.listAugmentationsForAgent).toBe("function");
    });
});
