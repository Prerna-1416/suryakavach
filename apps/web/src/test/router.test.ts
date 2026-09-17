import { describe, it, expect } from 'vitest';
import { parseLocation, catalogueUrl } from '../lib/router';

describe('parseLocation', () => {
  it('maps the root path to the home screen', () => {
    expect(parseLocation('/', '')).toEqual({ screen: 'home', flareId: null, minClass: 'ALL' });
  });

  it('parses each known screen', () => {
    expect(parseLocation('/live', '').screen).toBe('live');
    expect(parseLocation('/forecast', '').screen).toBe('forecast');
    expect(parseLocation('/impact', '').screen).toBe('impact');
    expect(parseLocation('/replay', '').screen).toBe('replay');
    expect(parseLocation('/catalogue', '').screen).toBe('catalogue');
    expect(parseLocation('/alerts', '').screen).toBe('alerts');
    expect(parseLocation('/about', '').screen).toBe('about');
  });

  it('keeps historic aliases alive', () => {
    expect(parseLocation('/monitor', '').screen).toBe('live');
    expect(parseLocation('/methodology', '').screen).toBe('about');
  });

  it('falls back to home for unknown paths', () => {
    expect(parseLocation('/nonsense', '').screen).toBe('home');
    expect(parseLocation('/nonsense/deep', '').screen).toBe('home');
  });

  it('extracts the flare id from /catalogue/:id', () => {
    expect(parseLocation('/catalogue/FLR-001', '').flareId).toBe('FLR-001');
  });

  it('ignores a flare id outside the catalogue screen', () => {
    expect(parseLocation('/alerts/FLR-001', '').flareId).toBeNull();
  });

  it('reads the class filter from ?class=', () => {
    expect(parseLocation('/catalogue', '?class=M').minClass).toBe('M');
    expect(parseLocation('/catalogue/FLR-001', '?class=X').minClass).toBe('X');
  });

  it('rejects unknown class values and defaults to ALL', () => {
    expect(parseLocation('/catalogue', '?class=Q').minClass).toBe('ALL');
    expect(parseLocation('/catalogue', '').minClass).toBe('ALL');
  });
});

describe('catalogueUrl', () => {
  it('omits the query when the filter is ALL', () => {
    expect(catalogueUrl(null, 'ALL')).toBe('/catalogue');
    expect(catalogueUrl('FLR-001', 'ALL')).toBe('/catalogue/FLR-001');
  });

  it('appends the class filter and encodes the flare id', () => {
    expect(catalogueUrl(null, 'M')).toBe('/catalogue?class=M');
    expect(catalogueUrl('FLR 01', 'X')).toBe('/catalogue/FLR%2001?class=X');
  });
});