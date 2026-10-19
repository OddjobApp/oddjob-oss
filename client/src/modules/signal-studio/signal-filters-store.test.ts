import { describe, it, expect, beforeEach } from 'vitest';
import {
  matchesSignalFilter,
  DEFAULT_SIGNAL_FILTERS,
  getStoredSignalFilters,
  upsertSignalFilter,
  deleteSignalFilter,
  type SignalFilter,
} from './signal-filters-store';

describe('Signal Filters Store & Matcher', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      localStorage.clear();
    }
  });

  describe('Default Presets Integrity', () => {
    it('contains canonical real estate distress filters', () => {
      const ids = DEFAULT_SIGNAL_FILTERS.map((f) => f.id);
      expect(ids).toContain('nod');
      expect(ids).toContain('auction');
      expect(ids).toContain('tax');
      expect(ids).toContain('substandard');
      expect(ids).toContain('probate');
    });

    it('contains cross-domain general-purpose harvesting filters', () => {
      const ids = DEFAULT_SIGNAL_FILTERS.map((f) => f.id);
      expect(ids).toContain('maritime_ais_drift');
      expect(ids).toContain('supply_chain_bottleneck');
      expect(ids).toContain('critical_infrastructure');
    });
  });

  describe('matchesSignalFilter keyword matching', () => {
    const nodFilter = DEFAULT_SIGNAL_FILTERS.find((f) => f.id === 'nod')!;
    const auctionFilter = DEFAULT_SIGNAL_FILTERS.find((f) => f.id === 'auction')!;
    const taxFilter = DEFAULT_SIGNAL_FILTERS.find((f) => f.id === 'tax')!;

    it('matches Notice of Default badge and text variations', () => {
      expect(matchesSignalFilter(nodFilter, 'Notice of Default')).toBe(true);
      expect(matchesSignalFilter(nodFilter, 'pre-foreclosure filing on parcel')).toBe(true);
      expect(matchesSignalFilter(nodFilter, 'Scheduled Trustee Auction')).toBe(false);
    });

    it('matches Auction and Trustee sales', () => {
      expect(matchesSignalFilter(auctionFilter, 'Scheduled Trustee Auction')).toBe(true);
      expect(matchesSignalFilter(auctionFilter, 'Sheriff foreclosure sale date')).toBe(true);
      expect(matchesSignalFilter(auctionFilter, 'Delinquent property tax')).toBe(false);
    });

    it('matches Delinquent Tax filings', () => {
      expect(matchesSignalFilter(taxFilter, 'Delinquent property tax ($14k)')).toBe(true);
      expect(matchesSignalFilter(taxFilter, 'Tax lien recorded')).toBe(true);
      expect(matchesSignalFilter(taxFilter, 'Clean title transfer')).toBe(false);
    });
  });

  describe('Attribute conditions evaluation', () => {
    const customLoanFilter: SignalFilter = {
      id: 'sub4_mortgage',
      label: 'Sub-4% Note Rate with Low Balance',
      icon: '📉',
      category: 'Capital Markets',
      matchMode: 'composite',
      keywords: ['mortgage', 'loan'],
      attributeConditions: [
        { field: 'interestRate', operator: 'less_than_or_equal', value: 4.0 },
        { field: 'remainingBalance', operator: 'less_than_or_equal', value: 350000 },
      ],
      enabled: true,
      createdAt: '2026-09-27T00:00:00Z',
    };

    it('matches when both keywords and numeric attribute conditions pass', () => {
      const matchingPayload = {
        interestRate: 3.25,
        remainingBalance: 280000,
        loanType: 'Conventional',
      };
      expect(matchesSignalFilter(customLoanFilter, 'Fixed rate mortgage loan tape', matchingPayload)).toBe(true);
    });

    it('fails when interest rate exceeds threshold', () => {
      const highRatePayload = {
        interestRate: 6.5,
        remainingBalance: 280000,
      };
      expect(matchesSignalFilter(customLoanFilter, 'Mortgage note', highRatePayload)).toBe(false);
    });

    it('fails when balance exceeds threshold', () => {
      const highBalancePayload = {
        interestRate: 3.0,
        remainingBalance: 850000,
      };
      expect(matchesSignalFilter(customLoanFilter, 'Mortgage note', highBalancePayload)).toBe(false);
    });
  });

  describe('Store CRUD operations', () => {
    it('saves, retrieves, and deletes custom filters', () => {
      const initial = getStoredSignalFilters();
      expect(initial.length).toBeGreaterThan(0);

      const customFilter: SignalFilter = {
        id: 'user_created_port_delay',
        label: 'LA/Long Beach Berth Delay > 7 Days',
        icon: '⚓',
        category: 'Maritime Logistics',
        matchMode: 'keywords',
        keywords: ['port delay', 'berth congestion', 'long beach'],
        enabled: true,
        isPreset: false,
        createdAt: new Date().toISOString(),
      };

      upsertSignalFilter(customFilter);
      const afterAdd = getStoredSignalFilters();
      expect(afterAdd.some((f) => f.id === 'user_created_port_delay')).toBe(true);

      deleteSignalFilter('user_created_port_delay');
      const afterDelete = getStoredSignalFilters();
      expect(afterDelete.some((f) => f.id === 'user_created_port_delay')).toBe(false);
    });

    it('prevents deletion of default presets', () => {
      deleteSignalFilter('nod');
      const filters = getStoredSignalFilters();
      expect(filters.some((f) => f.id === 'nod')).toBe(true);
    });
  });
});
