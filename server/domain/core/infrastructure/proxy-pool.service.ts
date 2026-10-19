
import { createLogger } from '@server/utils/logger.js';

import { fingerprintManagerService, type BrowserFingerprint } from './fingerprint-manager.service.js';

const logger = createLogger("ProxyPoolService");

interface ProxyEntry {
    connectionString: string;
    fingerprint?: BrowserFingerprint;
}

interface ProxyPool {
  name: string;
  proxies: ProxyEntry[];
  lastUsedIndex: number;
}

// For now, we'll use an in-memory store. This can be moved to a database later.
const proxyPools = new Map<string, ProxyPool>();

class ProxyPoolService {
  /**
   * Adds or updates a pool of proxy connection strings.
   */
  public addProxyPool(name: string, entries: (string | ProxyEntry)[]): void {
    if (!entries || entries.length === 0) {
      throw new Error('Proxy entries cannot be empty.');
    }
    logger.info(`Loading proxy pool "${name}" with ${entries.length} proxies.`);
    proxyPools.set(name, {
      name,
      proxies: entries.map(e => (typeof e === 'string' ? { connectionString: e } : e)),
      lastUsedIndex: -1,
    });
  }

  /**
   * Retrieves the next proxy identity from a named pool using a round-robin strategy.
   * @param name The name of the proxy pool.
   * @returns A proxy entry containing connection string and a fingerprint.
   */
  public getProxyIdentity(name: string): ProxyEntry | undefined {
    const pool = proxyPools.get(name);
    if (!pool) {
      logger.warn(`Proxy pool "${name}" not found.`);
      return undefined;
    }

    // Simple round-robin selection
    pool.lastUsedIndex = (pool.lastUsedIndex + 1) % pool.proxies.length;
    const entry = pool.proxies[pool.lastUsedIndex];

    // If the entry doesn't have a specific fingerprint, generate one on the fly.
    if (!entry.fingerprint) {
        entry.fingerprint = fingerprintManagerService.generateFingerprint();
    }

    return entry;
  }

  /**
   * For testing and admin purposes: lists all loaded proxy pools.
   */
  public listProxyPools(): { name: string; count: number }[] {
    return Array.from(proxyPools.values()).map(p => ({ name: p.name, count: p.proxies.length }));
  }
}

export const proxyPoolService = new ProxyPoolService();

// Pre-load a default pool for development and testing
// In production, these would come from a secure config or database.
proxyPoolService.addProxyPool('residential', [
  // Replace with actual residential proxy connection strings
  'http://user:pass@residential.proxy.provider.com:8000',
]);

proxyPoolService.addProxyPool('mobile', [
  // Replace with actual mobile proxy connection strings
  'http://user:pass@mobile.proxy.provider.com:8000',
]);
