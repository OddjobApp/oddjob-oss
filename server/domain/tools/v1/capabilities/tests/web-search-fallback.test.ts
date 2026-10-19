import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { runBrowser } = vi.hoisted(() => ({ runBrowser: vi.fn() }));
vi.mock('@domain/mission/selenium/runner.js', () => ({ SeleniumRunner: class { execute = runBrowser; } }));
import { WEB_TOOLS, isAcademicSearch, scholarlyTopic } from '../web.js';

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); runBrowser.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
describe('general web search fallback', () => {
    it('does not substitute academic papers when property-record search is blocked', async () => {
        fetchMock.mockResolvedValue({ ok: true, text: async () => '<html>Challenge: verify you are human</html>' });
        runBrowser.mockResolvedValue({ success: false, error: 'Search unavailable' });
        const output = await WEB_TOOLS.google_search.execute({ query: 'Orange County California overdue property tax data aggregator' }, {} as any);
        expect(output).toContain('Error: Web search is unavailable');
        expect(output).toContain('does not establish');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).not.toContain('arxiv');
        expect(runBrowser).toHaveBeenCalledTimes(1);
    });
    it('continues to a general search provider after an unparseable response', async () => {
        fetchMock.mockResolvedValue({ ok: true, text: async () => '<html>Challenge</html>' });
        runBrowser.mockResolvedValue({ success: true, extracted: { raw_body: 'Official property records search results with source links and county information. '.repeat(3) } });
        const output = await WEB_TOOLS.google_search.execute({ query: 'county property records' }, {} as any);
        expect(output).toContain('Official property records');
        expect(output).not.toContain('Challenge');
    });
    const arxivFeed = '<feed><entry><id>http://arxiv.org/abs/2401.1</id><title>Graph Paper</title><summary>S</summary><author><name>A</name></author></entry></feed>';
    const openReviewNote = (title: string, venueid: string, venue: string) => ({
        id: title.slice(0, 4), forum: 'f1',
        content: { title: { value: title }, abstract: { value: 'An abstract' }, authors: { value: ['Ada'] }, venue: { value: venue }, venueid: { value: venueid } },
    });
    /** Serve arXiv / OpenReview / DuckDuckGo from separate canned bodies. */
    const route = (arxiv: string, notes: unknown[], ddg = '<a class="result__a" href="https://example.com">Some blog</a>') =>
        fetchMock.mockImplementation(async (url: string) => {
            if (url.includes('export.arxiv.org')) return { ok: true, text: async () => arxiv };
            if (url.includes('openreview')) return { ok: true, json: async () => ({ notes }) };
            return { ok: true, text: async () => ddg };
        });
    const urls = () => fetchMock.mock.calls.map(c => String(c[0]));

    it('queries arXiv and OpenReview before the general search engine for scholarly queries', async () => {
        route(arxivFeed, [openReviewNote('Proceedings Paper', 'ICLR.cc/2025/Conference', 'ICLR 2025 Poster')]);
        const output = await WEB_TOOLS.google_search.execute({ query: 'research papers about graph neural networks' }, {} as any);
        expect(output).toContain('Graph Paper');
        expect(output).toContain('Proceedings Paper');
        expect(output).toContain('Venue: ICLR 2025 Poster — accepted');
        expect(urls().some(u => u.includes('duckduckgo'))).toBe(false);
    });
    it('searches the topic, not the words that marked the query as scholarly', async () => {
        route(arxivFeed, []);
        await WEB_TOOLS.google_search.execute({ query: 'research papers about graph neural networks' }, {} as any);
        const openReviewUrl = new URL(urls().find(u => u.includes('openreview'))!);
        expect(openReviewUrl.searchParams.get('term')).toBe('graph neural networks');
        expect(decodeURIComponent(urls().find(u => u.includes('arxiv'))!)).toContain('all:graph neural networks');
    });
    it('labels rejected and withdrawn OpenReview submissions', async () => {
        route('<feed></feed>', [
            openReviewNote('Rejected One', 'ICLR.cc/2025/Conference/Rejected_Submission', 'Submitted to ICLR 2025'),
            openReviewNote('Withdrawn One', 'ICLR.cc/2026/Conference/Withdrawn_Submission', 'ICLR 2026 Conference Withdrawn Submission'),
        ]);
        const output = await WEB_TOOLS.google_search.execute({ query: 'conference papers on diffusion' }, {} as any);
        expect(output).toContain('Venue: Submitted to ICLR 2025 — rejected');
        expect(output).toContain('— withdrawn');
    });
    it('falls through to the general search engine when no scholarly source has matches', async () => {
        route('<feed></feed>', [], '<html>Challenge</html>');
        runBrowser.mockResolvedValue({ success: false, error: 'blocked' });
        await WEB_TOOLS.google_search.execute({ query: 'research papers about graph neural networks' }, {} as any);
        expect(urls().some(u => u.includes('duckduckgo'))).toBe(true);
    });
    it('strips scholarly markers from the topic but keeps the query when nothing else remains', () => {
        expect(scholarlyTopic('find recent arXiv preprints on mixture of experts')).toBe('mixture of experts');
        expect(scholarlyTopic('OpenReview papers for RLHF')).toBe('RLHF');
        expect(scholarlyTopic('show me the latest OpenReview submissions about speculative decoding')).toBe('speculative decoding');
        expect(scholarlyTopic('graph neural networks arXiv papers')).toBe('graph neural networks');
        expect(scholarlyTopic('conference papers on on-device learning')).toBe('on-device learning');
        expect(scholarlyTopic('research papers on theory of mind for agents')).toBe('theory of mind for agents');
        expect(scholarlyTopic('research papers')).toBe('research papers');
    });
    it('keeps academic fallback available only for explicit scholarly searches', () => {
        expect(isAcademicSearch('research property tax aggregators')).toBe(false);
        expect(isAcademicSearch('research papers about graph neural networks')).toBe(true);
        expect(isAcademicSearch('NeurIPS conference papers on RLHF')).toBe(true);
        expect(isAcademicSearch('OpenReview submissions about diffusion')).toBe(true);
        expect(isAcademicSearch('bankruptcy court proceedings in Delaware')).toBe(false);
    });
    it('does not report an HTTP error page as a successfully read source', async () => {
        runBrowser.mockResolvedValue({ success: false, error: 'unavailable' });
        fetchMock.mockResolvedValue({ ok: false, status: 403 });
        const output = await WEB_TOOLS.browse_web.execute({ url: 'https://example.com', mode: 'local' }, {} as any);
        expect(output).toContain('Error: Could not read');
        expect(output).toContain('HTTP 403');
    });
});
