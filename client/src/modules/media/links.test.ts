import { describe, expect, it } from "vitest";
import { readStudioLink, studioLinkFor } from "./links";

describe("links to a place in Media Studio", () => {
  it("adds the studio's place to the room's address, keeping what else it carries, and reads it back", () => {
    const link = studioLinkFor({ tab: "film", productionId: 7, sceneId: 21, shotId: 32 }, "https://oddjob.test/crew/room-1?projectKey=film&shot=9#turn-4");
    expect(link).toBe("https://oddjob.test/crew/room-1?projectKey=film&studio=media&tab=film&production=7&scene=21&shot=32#turn-4");
    expect(readStudioLink(new URL(link).search)).toEqual({ tab: "film", productionId: 7, sceneId: 21, shotId: 32 });
  });

  it("ignores addresses that are not studio links, and ids that are not ids", () => {
    expect(readStudioLink("?projectKey=film")).toBeNull();
    expect(readStudioLink("?studio=forge&production=7")).toBeNull();
    expect(readStudioLink("?studio=media&tab=settings&production=seven&scene=-2&shot=3.5")).toEqual({ tab: "film" });
  });
});
