import { HarnessRegistryService } from './harness-registry.service.js';
import { db } from "@server/database_service.js";
import { operationalCycles } from "@shared/schema/operational-cycles.js";
import { eq } from "drizzle-orm";

describe('HarnessRegistryService', () => {
  let harnessRegistryService: HarnessRegistryService;

  beforeEach(async () => {
    harnessRegistryService = new HarnessRegistryService();
    // Clear operationalCycles table before each test
    await db.delete(operationalCycles);
  });

  it('should save and retrieve a harness version', async () => {
    const harnessId = 'test-harness';
    const version = '1.0.0';
    const definition = { key: 'value' };

    await harnessRegistryService.saveHarnessVersion(harnessId, version, definition);
    const retrievedHarness = await harnessRegistryService.getHarness(harnessId, version);

    expect(retrievedHarness).toBeDefined();
    expect(retrievedHarness.id).toBe(harnessId);
    expect(retrievedHarness.version).toBe(version);
    expect(retrievedHarness.definition).toEqual(definition);
  });

  it('should list all versions for a harness', async () => {
    const harnessId = 'test-harness';
    await harnessRegistryService.saveHarnessVersion(harnessId, '1.0.0', {});
    await harnessRegistryService.saveHarnessVersion(harnessId, '1.0.1', {});

    const versions = await harnessRegistryService.listHarnessVersions(harnessId);

    expect(versions).toEqual(['1.0.0', '1.0.1']);
  });

  it('should delete a harness version', async () => {
    const harnessId = 'test-harness';
    const version = '1.0.0';
    await harnessRegistryService.saveHarnessVersion(harnessId, version, {});

    let retrievedHarness = await harnessRegistryService.getHarness(harnessId, version);
    expect(retrievedHarness).toBeDefined();

    await harnessRegistryService.deleteHarnessVersion(harnessId, version);

    retrievedHarness = await harnessRegistryService.getHarness(harnessId, version);
    expect(retrievedHarness).toBeNull();
  });
});