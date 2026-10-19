import { db } from '@server/database_service.js';
import { territories } from '@shared/schema/territory.js';
import { TerritoryService } from './territory.service.js';
import { createTerritory } from '../../../../tests/helpers/test-data.js';

/**
 * assignToTerritory returns the FIRST territory whose rules match, so this test
 * only means anything against a known table. It created a territory and asserted
 * its own id came back, but cleaned up nothing — so the first run passed on an
 * empty table and every run after it matched the row left behind by the one
 * before ("expected 1 to be 3"). It was also the reason this file appeared to
 * pass alone and fail beside its neighbours.
 *
 * The table belongs to this suite alone, so it is cleared around each test.
 */
describe('TerritoryService', () => {
  let territoryService: TerritoryService;

  beforeEach(async () => {
    await db.delete(territories);
    territoryService = new TerritoryService();
  });

  afterAll(async () => {
    await db.delete(territories);
  });

  it('should assign a lead to the correct territory', async () => {
    const territory = await createTerritory('West Coast', 'The West Coast of the USA', { state: 'CA' });
    const lead = { state: 'CA' };

    const territoryId = await territoryService.assignToTerritory(lead);

    expect(territoryId).toBe(territory.id);
  });

  it('returns null when no territory claims the lead', async () => {
    await createTerritory('West Coast', 'The West Coast of the USA', { state: 'CA' });

    expect(await territoryService.assignToTerritory({ state: 'NY' })).toBeNull();
  });

  it('matches on every rule, not just the first', async () => {
    await createTerritory('California Enterprise', 'CA, enterprise only', {
      state: 'CA',
      segment: 'enterprise',
    });

    // Right state, wrong segment: a rule set is a conjunction.
    expect(await territoryService.assignToTerritory({ state: 'CA', segment: 'smb' })).toBeNull();
  });
});
