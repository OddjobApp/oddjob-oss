import { describe, it, expect } from "vitest";
import { parseScribeStationToScene } from "./scribe-to-media";

describe("parseScribeStationToScene", () => {
  it("parses slugline, [SHOT n] blocks, camera directions, and dialogue lines", () => {
    const rawStation = `
INT. CYBERNETIC WORKSHOP - NIGHT

Elena examines the fractured neural core under halogen lights.

[SHOT 1]
- Framing: Extreme Close-Up
- Camera: Orbit Left
- Subject: Elena's cybernetic iris reflecting holographic schematic data
- Lighting: Cool cyan fill with harsh neon amber rim
- Seed: #HERO_ELENA
- Duration: 3.5s
ELENA: "The memory registers are still intact."

[SHOT 2]
- Framing: Wide
- Camera: Dolly Backward
- Subject: Silas steps out of the shadow by the security airlock
- Lighting: Low key silhouette with emergency strobe
- Seed: #VILLAIN_SILAS
- Duration: 5s
SILAS: "Then hand them over."
`;

    const scene = parseScribeStationToScene("station_act1_scene2", "Neural Extraction", rawStation);

    expect(scene.sceneId).toBe("station_act1_scene2");
    expect(scene.sceneTitle).toBe("Neural Extraction");
    expect(scene.slugline).toBe("INT. CYBERNETIC WORKSHOP - NIGHT");
    expect(scene.setting).toBe("CYBERNETIC WORKSHOP");
    expect(scene.timeOfDay).toBe("NIGHT");
    expect(scene.shots).toHaveLength(2);

    // Shot 1
    const shot1 = scene.shots[0];
    expect(shot1.shotNumber).toBe(1);
    expect(shot1.framing).toBe("Extreme Close-Up");
    expect(shot1.cameraMotion).toBe("Orbit Left");
    expect(shot1.durationSeconds).toBe(3.5);
    expect(shot1.seed).toBe("#HERO_ELENA");
    expect(shot1.prompt).toContain("Extreme Close-Up shot");
    expect(shot1.prompt).toContain("Elena's cybernetic iris");
    expect(shot1.prompt).toContain("Orbit Left camera movement");
    expect(shot1.dialogue?.character).toBe("ELENA");
    expect(shot1.dialogue?.line).toBe("The memory registers are still intact.");

    // Shot 2
    const shot2 = scene.shots[1];
    expect(shot2.shotNumber).toBe(2);
    expect(shot2.framing).toBe("Wide");
    expect(shot2.cameraMotion).toBe("Dolly Backward");
    expect(shot2.durationSeconds).toBe(5);
    expect(shot2.dialogue?.character).toBe("SILAS");

    // Character anchors
    expect(scene.characterAnchors).toContain("char_hero_elena");
    expect(scene.characterAnchors).toContain("char_villain_silas");
  });

  it("handles fallback to default establishing shot when no shot blocks are provided", () => {
    const raw = "The camera pans across the misty mountain range as sun breaks through the clouds.";
    const scene = parseScribeStationToScene("station_intro", "Dawn Arrival", raw);

    expect(scene.shots).toHaveLength(1);
    expect(scene.shots[0].shotNumber).toBe(1);
    expect(scene.shots[0].prompt).toContain("The camera pans across the misty mountain range");
  });
});
