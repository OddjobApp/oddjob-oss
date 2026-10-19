import airports from './airports.json';

export const AIRPORT_SOURCE = 'https://ourairports.com/data/';
export const AIRPORT_SNAPSHOT_DATE = '2026-10-08';
const normalize = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// City catchment aliases include major airports outside the city municipality.
const metros: Record<string, string[]> = { tokyo: ['HND', 'NRT'], 'new york': ['JFK', 'LGA', 'EWR'], london: ['LHR', 'LGW', 'STN', 'LTN', 'LCY', 'SEN'], paris: ['CDG', 'ORY'], 'washington dc': ['DCA', 'IAD', 'BWI'] };

export function lookupAirports(query: string, country?: string, limit = 12) {
    const key = normalize(query);
    if (!key) return [];
    const codes = metros[key] ?? [];
    const ranked = airports.filter(a => !country || a.country === country.toUpperCase()).map(a => {
        const city = normalize(a.city), name = normalize(a.name), keywords = normalize(a.keywords);
        const score = a.code.toLowerCase() === key ? 1000 : codes.includes(a.code) ? 500
            : city === key ? 400 : name === key ? 450 : name.includes(key) ? 200 : city.includes(key) ? 150 : keywords.includes(key) ? 100 : 0;
        return { ...a, score };
    }).filter(a => a.score > 0).sort((a, b) => b.score - a.score || Number(b.scheduled) - Number(a.scheduled)
        || Number(b.type === 'large_airport') - Number(a.type === 'large_airport') || a.code.localeCompare(b.code));
    return ranked.slice(0, Math.min(30, Math.max(1, limit))).map(({ score, keywords, ...a }) => a);
}

export function resolveAirport(query: string) {
    const matches = lookupAirports(query);
    const exactCode = matches.find(a => a.code.toLowerCase() === query.trim().toLowerCase());
    if (exactCode) return { airport: exactCode, options: [exactCode] };
    const scheduled = matches.filter(a => a.scheduled && a.type !== 'small_airport');
    const options = scheduled.length ? scheduled : matches;
    return { airport: options.length === 1 ? options[0] : undefined, options };
}
