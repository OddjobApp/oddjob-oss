/**
 * Authored project timeline events.
 *
 * The point of these is not storage — it is that one row is reachable three
 * ways: a person reads it on the timeline, an agent resolves it through the
 * ontology, and a cold chat room in the project is primed by it. A test that
 * only proved the row saved would miss the entire feature.
 *
 * Runs against the test database via requireTestDatabaseUrl; never dev.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { requireTestDatabaseUrl } from '../../../../../tests/configure-test-environment.js';

const databaseUrl = requireTestDatabaseUrl();
process.env.DATABASE_URL = databaseUrl;

const { projectService } = await import('../../core/project.service.js');
const { ONTOLOGY_ADAPTERS } = await import('@domain/knowledge/core/ontology-adapters.js');
const { crewPrimersService } = await import('@domain/crew/core/crew-primers.service.js');

const pool = new Pool({ connectionString: databaseUrl });
const ids = { org: 0, project: 0, event: 0 };
const ctx = () => ({ organizationId: ids.org, userId: 'test-user', isOrgAdmin: true }) as any;

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

beforeAll(async () => {
  const org = await pool.query(`INSERT INTO orgs (name) VALUES ($1) RETURNING org_id`, [
    `proj-events-${Date.now()}`,
  ]);
  ids.org = org.rows[0].org_id;

  const project = await pool.query(
    `INSERT INTO projects (organization_id, key, name, objective, status, created_by)
     VALUES ($1,$2,$3,$4,'active','test-user') RETURNING id`,
    [ids.org, `pe-${Date.now()}`, 'Timeline project', 'Ship the thing'],
  );
  ids.project = project.rows[0].id;
}, 60_000);

afterAll(async () => {
  await pool.query(`DELETE FROM project_events WHERE organization_id = $1`, [ids.org]);
  await pool.query(`DELETE FROM projects WHERE organization_id = $1`, [ids.org]);
  await pool.query(`DELETE FROM orgs WHERE org_id = $1`, [ids.org]);
  await pool.end();
}, 60_000);

describe('authoring', () => {
  it('records an event a person put on the timeline', async () => {
    const event = await projectService.createEvent(ctx(), ids.project, {
      title: 'EU AI Act compliance deadline',
      description: 'Conformity documentation must be filed.',
      kind: 'deadline',
      severity: 'Critical',
      startsAt: inDays(3),
    });

    ids.event = event.id;
    expect(event.title).toBe('EU AI Act compliance deadline');
    expect(event.severity).toBe('Critical');
    expect(event.createdBy).toBe('test-user');
  }, 60_000);

  it('rejects a range that ends before it starts', async () => {
    await expect(projectService.createEvent(ctx(), ids.project, {
      title: 'Backwards',
      startsAt: inDays(5),
      endsAt: inDays(2),
    })).rejects.toThrow();
  }, 60_000);

  it('reads the timeline soonest-first, not newest-first', async () => {
    // A timeline is read forwards; the activity feed is the thing read backwards.
    await projectService.createEvent(ctx(), ids.project, { title: 'Later', startsAt: inDays(20) });
    await projectService.createEvent(ctx(), ids.project, { title: 'Sooner', startsAt: inDays(1) });

    const events = await projectService.listEvents(ctx(), ids.project);
    const titles = events.map(e => e.title);

    expect(titles.indexOf('Sooner')).toBeLessThan(titles.indexOf('Later'));
  }, 60_000);

  it('filters to a window', async () => {
    const events = await projectService.listEvents(ctx(), ids.project, {
      from: new Date(),
      to: inDays(5),
    });

    expect(events.some(e => e.title === 'Later')).toBe(false);
    expect(events.some(e => e.title === 'Sooner')).toBe(true);
  }, 60_000);
});

describe('referenceable by agents', () => {
  it('resolves through the ontology, the registry agents already use', async () => {
    const event = await ONTOLOGY_ADAPTERS.project_events.get(ctx(), ids.event);

    expect(event).not.toBeNull();
    expect(event!.title).toBe('EU AI Act compliance deadline');
    expect(event!.kind).toBe('deadline');
  }, 60_000);

  it('lists them for an agent asking what is on the timeline', async () => {
    const rows = await ONTOLOGY_ADAPTERS.project_events.list(ctx(), { limit: 50 });
    expect(rows.some(r => r.id === ids.event)).toBe(true);
  }, 60_000);

  it('does not leak across organisations', async () => {
    const otherOrg = { organizationId: ids.org + 999_999 } as any;
    expect(await ONTOLOGY_ADAPTERS.project_events.get(otherOrg, ids.event)).toBeNull();
  }, 60_000);
});

describe('primes agent chat in the project', () => {
  it('opens a cold room already knowing what is coming up', async () => {
    const primers = await crewPrimersService.build({ orgId: ids.org, projectId: ids.project });

    const fromEvent = primers.find(p => p.source === 'event');
    expect(fromEvent).toBeDefined();
    expect(fromEvent!.label).toContain('EU AI Act compliance deadline');
    // The lead time is what makes the primer actionable rather than a restatement.
    expect(fromEvent!.prompt).toMatch(/in 3 days|tomorrow|today/);
    expect(fromEvent!.prompt).toContain('Critical');
  }, 60_000);

  it('ignores events outside the horizon', async () => {
    await projectService.createEvent(ctx(), ids.project, {
      title: 'Distant strategy review',
      startsAt: inDays(200),
    });

    const primers = await crewPrimersService.build({ orgId: ids.org, projectId: ids.project });
    expect(primers.some(p => p.label.includes('Distant strategy review'))).toBe(false);
  }, 60_000);

  it('ignores events already in the past', async () => {
    // An agent asking what to do about last quarter's launch is noise.
    await projectService.createEvent(ctx(), ids.project, {
      title: 'Last quarter retro',
      startsAt: inDays(-30),
    });

    const primers = await crewPrimersService.build({ orgId: ids.org, projectId: ids.project });
    expect(primers.some(p => p.label.includes('Last quarter retro'))).toBe(false);
  }, 60_000);
});
