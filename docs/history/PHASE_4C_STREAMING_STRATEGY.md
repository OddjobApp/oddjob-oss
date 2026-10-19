# Phase 4C: Query Result Streaming Strategy

**Week:** Jul 01-05, 2026  
**Duration:** 7.5 hours  
**Purpose:** Stream large result sets to reduce memory and improve UX  
**Target Impact:** 2-3x UX improvement, 20x memory reduction

---

## 🎯 Overview

**Current Problem:** Large result sets load all data into memory at once
- 1000+ items loaded → 5-10MB per request
- Client waits for full response → slow perceived load time
- Database query times out on very large sets

**Solution:** Pagination + Server-Sent Events (SSE) for streaming results
- Fetch 50 items at a time (50KB per request) → 100x smaller
- Stream results to client immediately → 4-6x faster perceived load
- Browser receives data continuously → smooth UX

---

## 📊 Three-Part Strategy

### Part 1: Pagination Layer (Days 1-2)
**Cursor-based pagination for O(1) performance**

```
Traditional offset-based pagination:
  Page 1: OFFSET 0 LIMIT 50   → O(1) ✅
  Page 2: OFFSET 50 LIMIT 50  → O(n) ⚠️ (scans 50+ rows)
  Page 10: OFFSET 450 LIMIT 50 → O(n) ❌ (scans 450+ rows)

Cursor-based pagination:
  Page 1: WHERE id > cursor1 LIMIT 50  → O(1) ✅
  Page 2: WHERE id > cursor2 LIMIT 50  → O(1) ✅
  Page 10: WHERE id > cursor10 LIMIT 50 → O(1) ✅
```

**Key Benefits:**
- Constant time (O(1)) regardless of page number
- Works with large datasets (millions of rows)
- Browser back/forward buttons work seamlessly
- No sequential scanning

**Implementation:**
- `Paginator<T>` class with cursor encoding/decoding
- Validate limit (1-500, default 50)
- Support both cursor-based and offset-based (for compatibility)

### Part 2: Server-Sent Events (Days 3-4)
**Stream results to client continuously**

```
Traditional approach:
  Client GET /api/cycles
  Server: Build 1000-item response (1-5 seconds)
  Server: Send response (100KB)
  Client: Receive all 1000 items at once
  
SSE Streaming approach:
  Client: fetch(/api/cycles/stream)
  Server: Send 50 items (headers, start)
  Client: Render first 50 items immediately ⚡
  Server: Stream next 50 items
  Client: Render items as they arrive
  ... repeat until done
```

**Streaming Formats:**
- **CSV streaming** — For Excel/spreadsheet export
- **JSONL streaming** — For JavaScript/API clients
- Both support resume on disconnect

### Part 3: Client Handlers (Days 3-4)
**Progressive rendering in the browser**

```javascript
// Instead of waiting for full response
const response = await fetch('/api/cycles');
const data = await response.json();  // Wait 5 seconds
renderUI(data);

// Stream results as they arrive
const eventSource = new EventSource('/api/cycles/stream');
eventSource.onmessage = (event) => {
  const item = JSON.parse(event.data);
  appendToUI(item);  // Render immediately
};
```

---

## 🔧 Technical Implementation

### Pagination Service

**File:** `server/domain/pagination/pagination.service.ts`

```typescript
class Paginator<T> {
  // Cursor-based pagination (recommended)
  getPage(db, {
    cursor?: string,      // Opaque token for next page
    limit?: number,       // 1-500, default 50
    orderBy?: any[],      // Drizzle order conditions
    where?: any          // Drizzle where conditions
  }): Promise<{
    items: T[],
    nextCursor?: string,  // undefined = no more pages
    hasMore: boolean,
    totalOnPage: number,
    isFirstPage: boolean
  }>

  // Offset-based (simpler, slower)
  getPageByOffset(db, options): Promise<{...}>
}
```

**Usage Example:**

```typescript
const paginator = createPaginator(approvalRequests);

// First page
const page1 = await paginator.getPage(db, {
  limit: 50,
  where: eq(approvalRequests.status, 'pending'),
  orderBy: [desc(approvalRequests.createdAt)]
});

// Next page
const page2 = await paginator.getPage(db, {
  cursor: page1.nextCursor,  // ← Pass cursor for next page
  limit: 50,
  where: eq(approvalRequests.status, 'pending'),
  orderBy: [desc(approvalRequests.createdAt)]
});
```

### Streaming Endpoints

**Pattern 1: CSV Export (for Excel)**

```typescript
router.get('/api/approvals/export.csv', async (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  
  res.write('id,status,created_at,tool\n');
  
  let cursor;
  while (true) {
    const page = await paginator.getPage(db, {
      cursor,
      limit: 500  // Larger batches for CSV
    });
    
    // Stream CSV rows
    for (const item of page.items) {
      res.write(`${item.id},${item.status},${item.createdAt},${item.tool}\n`);
    }
    
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  
  res.end();
});
```

**Pattern 2: JSONL Streaming (for JavaScript)**

```typescript
router.get('/api/approvals/stream', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  
  let cursor;
  while (true) {
    const page = await paginator.getPage(db, {
      cursor,
      limit: 50
    });
    
    // Stream JSONL (one JSON object per line)
    for (const item of page.items) {
      res.write(JSON.stringify(item) + '\n');
      
      // Small delay to prevent overwhelming client
      await new Promise(resolve => setImmediate(resolve));
    }
    
    if (!page.hasMore) break;
    cursor = page.nextCursor;
  }
  
  res.end();
});
```

**Pattern 3: Server-Sent Events (for real-time UI)**

```typescript
router.get('/api/approvals/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  
  const stream = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  let cursor;
  let count = 0;
  
  while (true) {
    const page = await paginator.getPage(db, {
      cursor,
      limit: 50
    });
    
    for (const item of page.items) {
      stream({ item, progress: { count, total: 'unknown' } });
      count++;
    }
    
    if (!page.hasMore) {
      stream({ done: true, total: count });
      break;
    }
    cursor = page.nextCursor;
  }
  
  res.end();
});
```

### Client-Side Handler

```javascript
// Progressive rendering with EventSource
async function loadApprovalsStream() {
  const container = document.getElementById('approvals-list');
  let count = 0;
  
  const eventSource = new EventSource('/api/approvals/stream');
  
  eventSource.onmessage = (event) => {
    const { item, done, progress } = JSON.parse(event.data);
    
    if (done) {
      eventSource.close();
      container.innerHTML += `<p>Loaded ${count} items</p>`;
      return;
    }
    
    // Render each item as it arrives
    const div = document.createElement('div');
    div.innerHTML = `${item.id}: ${item.status}`;
    container.appendChild(div);
    count++;
    
    // Update progress indicator
    document.getElementById('progress').textContent = `${count} loaded...`;
  };
  
  eventSource.onerror = (error) => {
    console.error('Stream error:', error);
    eventSource.close();
  };
}
```

---

## 📈 Performance Impact

### Memory Reduction

**Before Streaming:**
```
GET /api/approvals (all items)
  1000 items × 5KB = 5MB in memory
  + JSON overhead = 6-8MB
  Query time: 3-5 seconds
```

**After Streaming:**
```
GET /api/approvals/stream
  50 items × 5KB = 250KB in memory
  × N batches = 250KB per batch
  Query time: 0.5 seconds (first page)
  
Improvement: 8MB → 250KB = 32x memory reduction! 🚀
```

### UX Improvement

**Before:**
- User clicks "View Approvals"
- 3-5 second wait
- All 1000 items appear at once
- User scrolls through wall of text

**After:**
- User clicks "View Approvals"
- First 50 items appear immediately (500ms)
- More items stream in while user reads
- Perceived load time: 10x faster ⚡

---

## 🎯 Success Criteria

- [ ] Pagination service deployed (O(1) cursor-based)
- [ ] CSV streaming endpoint working
- [ ] JSONL streaming endpoint working
- [ ] SSE client handler functional
- [ ] Initial page load: 4-6x faster
- [ ] Memory per page: 20x reduction
- [ ] Network payload: 100x reduction
- [ ] Resume on disconnect working

---

## 📋 Implementation Timeline

**Days 1-2: Pagination (2 hours)**
- [ ] Implement `Paginator<T>` class
- [ ] Add cursor encoding/decoding
- [ ] Add validation helpers
- [ ] Unit tests

**Days 3-4: Streaming (4 hours)**
- [ ] CSV export endpoint
- [ ] JSONL streaming endpoint
- [ ] SSE streaming endpoint
- [ ] Client-side event handlers
- [ ] Resume/retry logic

**Day 5: Testing (1.5 hours)**
- [ ] Load testing with 10K+ items
- [ ] Memory usage validation
- [ ] Browser compatibility testing
- [ ] Documentation

---

## 🔄 Comparison: Three Approaches

| Approach | Memory | Latency | Browser Support | Use Case |
|----------|--------|---------|-----------------|----------|
| All at once | 8MB | 3-5s | All | Small datasets (<100 items) |
| Pagination | 250KB | 500ms | All | Large datasets, UI pagination |
| SSE Streaming | 250KB | 500ms | Modern | Real-time updates, progressive loading |

---

## 💡 Key Takeaways

1. **Cursor-based pagination:** O(1) performance regardless of page number
2. **Streaming:** Client sees results immediately, perceives 10x faster load
3. **Formats:** CSV for exports, JSONL for APIs, SSE for real-time UX
4. **Memory:** 32x reduction from 8MB to 250KB per request
5. **Bandwidth:** 100x reduction: send 50 items instead of 1000

---

**Phase 4C targets 2-3x UX improvement + 20x memory reduction**

Ready to implement! 🚀

