import { describe, expect, it } from 'vitest';
import { crewDevelopmentBindingSchema } from './crew-development-binding';
const binding = { cycleId: 7, repositoryUrl: 'https://github.com/example/project', branch: 'codex/test', testEnvironment: 'isolated local fixture' };
describe('development configuration', () => {
  it('accepts a named target without conferring execution permission', () => {
    expect(crewDevelopmentBindingSchema.parse(binding)).toEqual(binding);
  });
  it.each(['https://secret@example.com/repo', 'https://example.com/repo?token=secret', 'file:///private/repo', 'https://example.com/repo#secret'])('rejects credential-bearing or unsupported repository target %s', repositoryUrl => {
    expect(crewDevelopmentBindingSchema.safeParse({ ...binding, repositoryUrl }).success).toBe(false);
  });
  it('requires an explicit cycle, branch and test environment', () => {
    expect(crewDevelopmentBindingSchema.safeParse({ ...binding, cycleId: 0 }).success).toBe(false);
    expect(crewDevelopmentBindingSchema.safeParse({ ...binding, branch: ' ' }).success).toBe(false);
    expect(crewDevelopmentBindingSchema.safeParse({ ...binding, testEnvironment: '' }).success).toBe(false);
  });
});
