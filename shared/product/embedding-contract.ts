export interface EmbeddingDescriptor {
  provider: string;
  model: string;
  dimensions: number;
  version: string;
}

export interface VersionedEmbedding extends EmbeddingDescriptor {
  vector: number[];
}

export function embeddingSpacesCompatible(a: EmbeddingDescriptor, b: EmbeddingDescriptor): boolean {
  return a.provider === b.provider
    && a.model === b.model
    && a.dimensions === b.dimensions
    && a.version === b.version;
}

export function cosineSimilarity(a: VersionedEmbedding, b: VersionedEmbedding): number | null {
  if (!embeddingSpacesCompatible(a, b) || a.vector.length !== a.dimensions || b.vector.length !== b.dimensions) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.vector.length; i++) {
    dot += a.vector[i] * b.vector[i];
    normA += a.vector[i] ** 2;
    normB += b.vector[i] ** 2;
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
