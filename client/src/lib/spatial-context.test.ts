import { describe, expect, it } from 'vitest';
import { buildSpatialUrl, parseSpatialContext } from './spatial-context';

describe('spatial context URLs', () => {
  it('parses signal, entity, scenario, comparison, and horizon context', () => {
    expect(parseSpatialContext('?signal=s-1&entityType=cycle&entityId=42&scenario=sc-2&compare=baseline&horizon=30d')).toEqual({
      signalId: 's-1',
      entityRefs: [{ type: 'cycle', id: '42' }],
      scenarioId: 'sc-2',
      compare: 'baseline',
      timeHorizon: '30d',
      view: undefined,
    });
  });

  it('builds an encoded deep link for other features', () => {
    expect(buildSpatialUrl({
      signalId: 'signal/one',
      entityRefs: [{ type: 'workstream', id: 'north america' }],
    })).toBe('/workspace/spatial?signal=signal%2Fone&entityType=workstream&entityId=north+america');
  });

  it('omits partial entity references', () => {
    expect(parseSpatialContext('?entityType=cycle')).toEqual({ entityRefs: [], view: undefined });
  });

  it('parses view parameter from URL', () => {
    expect(parseSpatialContext('?view=sources')).toEqual({
      signalId: undefined,
      entityRefs: [],
      scenarioId: undefined,
      compare: undefined,
      timeHorizon: undefined,
      view: 'sources',
    });
  });

  it('parses all valid view values', () => {
    expect(parseSpatialContext('?view=signals').view).toBe('signals');
    expect(parseSpatialContext('?view=sources').view).toBe('sources');
    expect(parseSpatialContext('?view=backbone').view).toBe('backbone');
    expect(parseSpatialContext('?view=subscriptions').view).toBe('subscriptions');
  });

  it('ignores invalid view values', () => {
    expect(parseSpatialContext('?view=invalid').view).toBeUndefined();
    expect(parseSpatialContext('?view=').view).toBeUndefined();
  });

  it('includes view in built URL when set', () => {
    expect(buildSpatialUrl({ view: 'sources' })).toBe('/workspace/spatial?view=sources');
    expect(buildSpatialUrl({ signalId: 's-1', view: 'backbone' }))
      .toBe('/workspace/spatial?signal=s-1&view=backbone');
  });

  it('omits view from built URL when not set', () => {
    expect(buildSpatialUrl({})).toBe('/workspace/spatial');
    expect(buildSpatialUrl({ signalId: 's-1' })).toBe('/workspace/spatial?signal=s-1');
  });

  it('parses view combined with other params', () => {
    const ctx = parseSpatialContext('?signal=abc&view=subscriptions&horizon=7d');
    expect(ctx.signalId).toBe('abc');
    expect(ctx.view).toBe('subscriptions');
    expect(ctx.timeHorizon).toBe('7d');
  });
});
