import { z } from 'zod';

export const crewDevelopmentBindingSchema = z.object({
  cycleId: z.number().int().positive(),
  repositoryUrl: z.string().url().max(500).refine(value => {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, 'Use a repository URL without credentials, query parameters, or fragments'),
  branch: z.string().trim().min(1).max(150),
  testEnvironment: z.string().trim().min(1).max(300),
}).strict();
export type CrewDevelopmentBinding = z.infer<typeof crewDevelopmentBindingSchema>;
