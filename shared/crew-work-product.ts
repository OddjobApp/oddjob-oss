import { z } from 'zod';

export const crewWorkProductSchema = z.object({
  type: z.literal('crew_work_product'),
  documentKey: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(50000),
  changeSummary: z.string().trim().min(1).max(1000),
  sourceTurnId: z.number().int().positive().optional(),
});
export type CrewWorkProduct = z.infer<typeof crewWorkProductSchema>;

export function collectWorkProducts(turns: Array<{ id: number; speakerName: string; artifacts?: Array<{ payload?: unknown }> }>) {
  return [...turns].sort((a, b) => a.id - b.id).flatMap(turn =>
    (turn.artifacts ?? []).flatMap((artifact, index) => {
      const parsed = crewWorkProductSchema.safeParse(artifact.payload);
      return parsed.success ? [{ ...parsed.data, turnId: turn.id, author: turn.speakerName, versionKey: `${turn.id}-${index}` }] : [];
    }));
}
