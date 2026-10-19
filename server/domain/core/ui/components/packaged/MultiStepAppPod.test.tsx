import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MultiStepAppPod from "./MultiStepAppPod.js";
import { packagedComponentNames } from "./registry.js";
import { ASSEMBLY_TOOLS } from "@domain/tools/v1/capabilities/assembly-tools.js";
import { RICH_PAYLOAD_TYPES } from "@domain/crew/core/crew-tools.service.js";

/**
 * A chat-inline artifact is a SIX-PIECE CONTRACT and every piece has to line up:
 * the tool emits a payload type, that type is in RICH_PAYLOAD_TYPES, the client
 * has a branch for it, the branch names a module, the registry resolves that
 * module, and the component renders. Miss one and the artifact silently vanishes
 * or renders as raw JSON.
 *
 * These assert the pieces that can be checked without a browser. Note that the
 * InstantAppRenderer wraps its failure notice in the same chrome as a success,
 * so "the artifact rendered" is NOT evidence the pod mounted — hence the explicit
 * registry-resolution check below.
 */
describe("MultiStepAppPod chat-inline contract", () => {
    it("emits an assistant_app payload, which is a recognised rich type", () => {
        const tool = ASSEMBLY_TOOLS.start_multistep_run;
        expect(tool, "start_multistep_run is not defined").toBeDefined();
        expect(tool.name).toBe("start_multistep_run");
        // The client already has a branch for assistant_app; reusing it is why this
        // needs no new payload type or renderer.
        expect(RICH_PAYLOAD_TYPES.has("assistant_app")).toBe(true);
    });

    it("is resolvable from the packaged registry by the module name the tool emits", () => {
        // The tool hardcodes module/componentName "MultiStepAppPod". If the file is
        // renamed or moved out of packaged/, the registry glob stops finding it and
        // the pod becomes an 'isn't available to render' notice.
        expect(packagedComponentNames()).toContain("MultiStepAppPod");
    });

    it("says so plainly when no session id was supplied", () => {
        render(<MultiStepAppPod />);
        expect(screen.getByTestId("multistep-no-session")).toBeTruthy();
        // It must NOT render an empty wizard, which reads as a run with no steps.
        expect(screen.queryByTestId("multistep-app-pod")).toBeNull();
    });
});
