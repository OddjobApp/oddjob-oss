import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { crewRepository } from "../crew-repository.js";
import { crewToolsService } from "../crew-tools.service.js";

describe("authoring tool boundary", () => {
    const execute = vi.fn();
    const context = { organizationId: 7, userId: "author", sessionKey: "room", authoringUserTurnId: 10, named: { message: "Rewrite the section" }, positional: {} };
    const tool = (name: string) => [{ definition: { name, parameters: z.object({}), execute } }] as any;

    beforeEach(() => {
        vi.restoreAllMocks();
        execute.mockReset().mockResolvedValue("done");
        vi.spyOn(crewRepository, "findSession").mockResolvedValue({ id: 1, interrupting: false, cycleContext: {} } as any);
        vi.spyOn(crewRepository, "latestUserTurnId").mockResolvedValue(10);
    });

    it("blocks a tool after pause even when its model response arrived later", async () => {
        vi.mocked(crewRepository.findSession).mockResolvedValue({ id: 1, cycleContext: { authoringPaused: true } } as any);
        const result = await crewToolsService.execute("scribe_update_node", {}, tool("scribe_update_node"), context);
        expect(result.record.ok).toBe(false);
        expect(execute).not.toHaveBeenCalled();
    });

    it("blocks stale work after a pause has been resumed", async () => {
        vi.mocked(crewRepository.latestUserTurnId).mockResolvedValue(12);
        const result = await crewToolsService.execute("scribe_update_node", {}, tool("scribe_update_node"), context);
        expect(result.record.ok).toBe(false);
        expect(execute).not.toHaveBeenCalled();
    });

    it.each(["scribe_update_node", "scribe_configure_stations", "mount_scribe_studio"])("blocks %s on a review-only request", async (name) => {
        const result = await crewToolsService.execute(name, {}, tool(name), { ...context, named: { message: "Review this without editing" } });
        expect(result.record.ok).toBe(false);
        expect(execute).not.toHaveBeenCalled();
    });

    it("permits an intentional review tool", async () => {
        await crewToolsService.execute("scribe_run_critic_pass", {}, tool("scribe_run_critic_pass"), { ...context, named: { message: "Review this" } });
        expect(execute).toHaveBeenCalledOnce();
    });
});
