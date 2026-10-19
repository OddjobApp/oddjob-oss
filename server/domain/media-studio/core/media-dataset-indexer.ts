/**
 * Knowledge Garden Dataset Indexer for Media Studio.
 *
 * Automatically records approved takes, prompt snapshots, and aesthetic tags into
 * Oddjob Datasets (`media_takes_catalog`), enabling semantic retrieval and
 * cross-production asset reuse.
 */

export interface MediaTakeDatasetRecord {
  id: string;
  takeId: string;
  sceneId: string;
  sceneTitle: string;
  shotNumber: number;
  prompt: string;
  cameraMotion?: string;
  characterAnchorId?: string;
  aspectRatio: string;
  durationSeconds: number;
  videoUrl?: string;
  keyframeUrl?: string;
  seed: number;
  status: "approved" | "completed" | "rendering" | "rejected";
  tags: string[];
  createdAt: string;
}

/**
 * Transforms a take into a standardized Oddjob Dataset record.
 */
export function formatTakeForDatasetCatalog(params: {
  productionId?: number | string;
  sceneId: string;
  sceneTitle: string;
  shotNumber: number;
  takeId: string;
  prompt: string;
  cameraMotion?: string;
  characterAnchorId?: string;
  aspectRatio: string;
  durationSeconds: number;
  videoUrl?: string;
  keyframeUrl?: string;
  seed: number;
  status: "approved" | "completed" | "rendering" | "rejected";
}): MediaTakeDatasetRecord {
  const tags = new Set<string>();

  // Extract automatic aesthetic tags
  if (params.aspectRatio) tags.add(`ratio:${params.aspectRatio}`);
  if (params.cameraMotion) tags.add(`camera:${params.cameraMotion.toLowerCase().replace(/\s+/g, "_")}`);
  if (params.characterAnchorId) tags.add(`character:${params.characterAnchorId}`);
  if (params.status) tags.add(`status:${params.status}`);

  // Tokenize prompt keywords
  const keywords = params.prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["shot", "with", "from", "that", "this", "over", "into"].includes(w));

  for (const kw of keywords.slice(0, 10)) {
    tags.add(kw);
  }

  return {
    id: `cat_take_${params.takeId}`,
    takeId: params.takeId,
    sceneId: params.sceneId,
    sceneTitle: params.sceneTitle,
    shotNumber: params.shotNumber,
    prompt: params.prompt,
    cameraMotion: params.cameraMotion,
    characterAnchorId: params.characterAnchorId,
    aspectRatio: params.aspectRatio,
    durationSeconds: params.durationSeconds,
    videoUrl: params.videoUrl,
    keyframeUrl: params.keyframeUrl,
    seed: params.seed,
    status: params.status,
    tags: Array.from(tags),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Evaluates semantic/keyword relevance of a search query against cataloged takes.
 */
export function searchMediaTakesDataset(
  query: string,
  records: MediaTakeDatasetRecord[]
): { record: MediaTakeDatasetRecord; score: number }[] {
  if (!query.trim()) {
    return records.map((r) => ({ record: r, score: 1.0 }));
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const scored = records.map((record) => {
    let score = 0;
    const searchable = [
      record.prompt,
      record.sceneTitle,
      record.cameraMotion || "",
      record.characterAnchorId || "",
      ...record.tags,
    ].join(" ").toLowerCase();

    for (const term of queryTerms) {
      if (searchable.includes(term)) {
        score += 1.0;
        // Bonus if matches character or camera explicitly
        if (record.characterAnchorId?.toLowerCase().includes(term)) score += 1.5;
        if (record.cameraMotion?.toLowerCase().includes(term)) score += 1.0;
      }
    }

    // Boost approved takes
    if (record.status === "approved") score *= 1.2;

    return { record, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}
