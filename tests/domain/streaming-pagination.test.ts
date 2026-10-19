import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Paginator, createPaginator } from '../../server/domain/pagination/pagination.service';
import { CSVStreamer, JSONLStreamer, SSEStreamer } from '../../server/domain/streaming/streaming.service';

describe('Pagination Service', () => {
  it('instantiates Paginator with a table', () => {
    const dummyTable = { _: { name: 'test_table' } };
    const paginator = createPaginator(dummyTable);
    expect(paginator).toBeInstanceOf(Paginator);
  });
});

describe('Streaming Service', () => {
  let mockResponse: any;

  beforeEach(() => {
    mockResponse = {
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
  });

  it('formats CSV streams correctly', () => {
    const streamer = CSVStreamer.streamResults(mockResponse, ['ID', 'Name'], (item) => [item.id, item.name]);

    expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(mockResponse.write).toHaveBeenCalledWith('"ID","Name"\n');

    streamer.writeRow({ id: 1, name: 'TestItem' });
    expect(mockResponse.write).toHaveBeenCalledWith('"1","TestItem"\n');
  });

  it('formats JSONL streams correctly', () => {
    const streamer = JSONLStreamer.streamResults(mockResponse);

    expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/x-ndjson; charset=utf-8');

    streamer.writeItem({ id: 1, name: 'TestItem' });
    expect(mockResponse.write).toHaveBeenCalledWith(JSON.stringify({ id: 1, name: 'TestItem' }) + '\n');
  });

  it('formats SSE streams correctly', () => {
    const streamer = SSEStreamer.streamResults(mockResponse);

    expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream; charset=utf-8');

    streamer.writeItem({ id: 1, status: 'pending' }, { page: 1, hasMore: true });
    expect(mockResponse.write).toHaveBeenCalled();
  });
});
