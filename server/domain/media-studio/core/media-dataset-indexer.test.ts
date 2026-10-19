import { describe, it, expect } from "vitest";
import { formatTakeForDatasetCatalog, searchMediaTakesDataset } from "./media-dataset-indexer";

describe("Media Dataset Indexer", () => {
  it("formats take into standardized dataset record with aesthetic tags", () => {
    const record = formatTakeForDatasetCatalog({
      sceneId: "scene_01",
      sceneTitle: "Neon Infiltration",
      shotNumber: 2,
      takeId: "take_098",
      prompt: "Elena grapples across the rainy glass skyscraper roof with golden sparks",
      cameraMotion: "Orbit Left",
      characterAnchorId: "char_elena",
      aspectRatio: "2.39:1",
      durationSeconds: 4.5,
      seed: 888123,
      status: "approved",
    });

    expect(record.id).toBe("cat_take_take_098");
    expect(record.tags).toContain("ratio:2.39:1");
    expect(record.tags).toContain("camera:orbit_left");
    expect(record.tags).toContain("character:char_elena");
    expect(record.tags).toContain("status:approved");
    expect(record.tags).toContain("elena");
    expect(record.tags).toContain("skyscraper");
  });

  it("searches and scores media takes by character, motion, and prompt keywords", () => {
    const r1 = formatTakeForDatasetCatalog({
      sceneId: "scene_01",
      sceneTitle: "Rooftop Arrival",
      shotNumber: 1,
      takeId: "t1",
      prompt: "Elena stands overlooking the cyberpunk skyline under neon drizzle",
      cameraMotion: "Pan Right",
      characterAnchorId: "char_elena",
      aspectRatio: "16:9",
      durationSeconds: 5,
      seed: 123,
      status: "approved",
    });

    const r2 = formatTakeForDatasetCatalog({
      sceneId: "scene_02",
      sceneTitle: "Underground Vault",
      shotNumber: 1,
      takeId: "t2",
      prompt: "Silas unlocks the vault laser door with a plasma cutter",
      cameraMotion: "Static",
      characterAnchorId: "char_silas",
      aspectRatio: "16:9",
      durationSeconds: 4,
      seed: 456,
      status: "completed",
    });

    const results = searchMediaTakesDataset("Elena cyberpunk", [r1, r2]);
    expect(results).toHaveLength(1);
    expect(results[0].record.takeId).toBe("t1");
    expect(results[0].score).toBeGreaterThan(1);
  });
});
