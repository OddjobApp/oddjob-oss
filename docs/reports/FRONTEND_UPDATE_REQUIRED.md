# Frontend Updates Required for Knowledge Graph Backend Changes

## Overview
The backend API responses have changed for list endpoints (now return paginated objects instead of arrays). The frontend needs to be updated to handle these changes.

---

## 🔴 Critical Changes Required

### 1. List Endpoints Response Format Change

**Before:**
```typescript
GET /api/knowledge-graph/nodes
// Returns: KnowledgeNode[]
```

**After:**
```typescript
GET /api/knowledge-graph/nodes
// Returns: { nodes: KnowledgeNode[]; total: number; page: number; limit: number }
```

**Same change applies to:**
- `GET /api/knowledge-graph/edges` → Returns `{ edges: KnowledgeEdge[]; total: number; page: number; limit: number }`

---

## 📝 Files That Need Updates

### 1. `client/src/pages/KnowledgeGraph.tsx` ⚠️ **CRITICAL**

**Current Code (Lines 198-214):**
```typescript
const { data: nodesData = [], isLoading: isLoadingNodes, refetch: refetchNodes } = useQuery<KnowledgeNode[]>({
  queryKey: ["/api/knowledge-graph/nodes"],
  queryFn: async () => {
    const res = await apiRequest("GET", "/api/knowledge-graph/nodes");
    return res.json();
  },
  enabled: viewMode === "instance",
});

const { data: edgesData = [], refetch: refetchEdges } = useQuery<KnowledgeEdge[]>({
  queryKey: ["/api/knowledge-graph/edges"],
  queryFn: async () => {
    const res = await apiRequest("GET", "/api/knowledge-graph/edges");
    return res.json();
  },
  enabled: viewMode === "instance" && nodesData.length > 0,
});
```

**Required Changes:**
```typescript
// Define paginated response type
interface PaginatedNodesResponse {
  nodes: KnowledgeNode[];
  total: number;
  page: number;
  limit: number;
}

interface PaginatedEdgesResponse {
  edges: KnowledgeEdge[];
  total: number;
  page: number;
  limit: number;
}

const { data: nodesResponse, isLoading: isLoadingNodes, refetch: refetchNodes } = useQuery<PaginatedNodesResponse>({
  queryKey: ["/api/knowledge-graph/nodes"],
  queryFn: async () => {
    const res = await apiRequest("GET", "/api/knowledge-graph/nodes");
    return res.json();
  },
  enabled: viewMode === "instance",
});

const nodesData = nodesResponse?.nodes ?? [];
const nodesTotal = nodesResponse?.total ?? 0;

const { data: edgesResponse, refetch: refetchEdges } = useQuery<PaginatedEdgesResponse>({
  queryKey: ["/api/knowledge-graph/edges"],
  queryFn: async () => {
    const res = await apiRequest("GET", "/api/knowledge-graph/edges");
    return res.json();
  },
  enabled: viewMode === "instance" && nodesData.length > 0,
});

const edgesData = edgesResponse?.edges ?? [];
const edgesTotal = edgesResponse?.total ?? 0;
```

**Also update line 213:**
```typescript
// Change from:
enabled: viewMode === "instance" && nodesData.length > 0,
// To:
enabled: viewMode === "instance" && (nodesResponse?.nodes?.length ?? 0) > 0,
```

---

### 2. `client/src/components/EdgeEditDialog.tsx` ⚠️ **CRITICAL**

**Current Code (Lines 84-90):**
```typescript
const { data: nodes = [] } = useQuery<KnowledgeNode[]>({
  queryKey: ["/api/knowledge-graph/nodes"],
  queryFn: async () => {
    const res = await apiRequest("GET", "/api/knowledge-graph/nodes");
    return res.json();
  },
});
```

**Required Changes:**
```typescript
const { data: nodesResponse } = useQuery<{ nodes: KnowledgeNode[]; total: number; page: number; limit: number }>({
  queryKey: ["/api/knowledge-graph/nodes"],
  queryFn: async () => {
    const res = await apiRequest("GET", "/api/knowledge-graph/nodes");
    return res.json();
  },
});

const nodes = nodesResponse?.nodes ?? [];
```

---

### 3. Error Handling Updates

**New Error Response Format:**
```typescript
// Validation errors now return:
{
  message: "Validation failed",
  errors: [
    { path: ["field"], message: "Error message" }
  ]
}

// Duplicate/conflict errors return 409 status with:
{
  message: "Edge already exists between source X and target Y with relation Z"
}
```

**Update error handling in:**
- `client/src/components/NodeEditDialog.tsx` (lines 245-249)
- `client/src/components/EdgeEditDialog.tsx` (error handling)
- `client/src/pages/KnowledgeGraph.tsx` (any error handling)

**Example Update:**
```typescript
// Before:
catch (error: any) {
  toast({
    title: "Error",
    description: error.message || "Failed to save node",
    variant: "destructive",
  });
}

// After:
catch (error: any) {
  let errorMessage = error.message || "Failed to save node";
  
  // Handle validation errors
  if (error.errors && Array.isArray(error.errors)) {
    const validationErrors = error.errors
      .map((e: any) => `${e.path?.join('.') || 'field'}: ${e.message}`)
      .join(', ');
    errorMessage = `Validation failed: ${validationErrors}`;
  }
  
  toast({
    title: "Error",
    description: errorMessage,
    variant: "destructive",
  });
}
```

---

## 🟡 Optional Improvements

### 4. Add Pagination UI (Recommended)

**Files to Update:**
- `client/src/pages/KnowledgeGraph.tsx`

**Add pagination state:**
```typescript
const [nodesPage, setNodesPage] = useState(1);
const [nodesLimit, setNodesLimit] = useState(50);
const [edgesPage, setEdgesPage] = useState(1);
const [edgesLimit, setEdgesLimit] = useState(50);
```

**Update queries to include pagination:**
```typescript
const { data: nodesResponse } = useQuery<PaginatedNodesResponse>({
  queryKey: ["/api/knowledge-graph/nodes", nodesPage, nodesLimit],
  queryFn: async () => {
    const res = await apiRequest("GET", `/api/knowledge-graph/nodes?page=${nodesPage}&limit=${nodesLimit}`);
    return res.json();
  },
});
```

**Add pagination controls:**
```typescript
// Add pagination component (using shadcn/ui or similar)
<Pagination>
  <PaginationContent>
    <PaginationItem>
      <PaginationPrevious 
        onClick={() => setNodesPage(p => Math.max(1, p - 1))}
        disabled={nodesPage === 1}
      />
    </PaginationItem>
    <PaginationItem>
      <PaginationLabel>
        Page {nodesPage} of {Math.ceil((nodesResponse?.total ?? 0) / nodesLimit)}
      </PaginationLabel>
    </PaginationItem>
    <PaginationItem>
      <PaginationNext 
        onClick={() => setNodesPage(p => p + 1)}
        disabled={nodesPage >= Math.ceil((nodesResponse?.total ?? 0) / nodesLimit)}
      />
    </PaginationItem>
  </PaginationContent>
</Pagination>
```

---

### 5. Batch Operations Support (Optional)

**New Endpoints Available:**
- `POST /api/knowledge-graph/nodes/batch`
- `POST /api/knowledge-graph/edges/batch`

**Use Case:** When creating multiple nodes/edges at once, use batch endpoints for better performance.

**Example:**
```typescript
const createNodesBatch = async (nodes: CreateKnowledgeNodeInput[]) => {
  const res = await apiRequest("POST", "/api/knowledge-graph/nodes/batch", nodes);
  const data = await res.json();
  return data; // { created: number, total: number, nodes: KnowledgeNode[] }
};
```

---

## 📋 Summary Checklist

### Critical (Must Fix)
- [ ] Update `KnowledgeGraph.tsx` to handle paginated responses
- [ ] Update `EdgeEditDialog.tsx` to handle paginated responses
- [ ] Update error handling to show validation errors
- [ ] Test all knowledge graph list operations

### Recommended (Should Fix)
- [ ] Add pagination UI to KnowledgeGraph page
- [ ] Add pagination state management
- [ ] Update TypeScript types for paginated responses

### Optional (Nice to Have)
- [ ] Add batch operation support in UI
- [ ] Add loading states for pagination
- [ ] Add search/filter support with pagination

---

## 🔍 Testing Checklist

After making changes, test:

1. **List Nodes:**
   - ✅ Nodes list displays correctly
   - ✅ Pagination works (if implemented)
   - ✅ Total count displays correctly

2. **List Edges:**
   - ✅ Edges list displays correctly
   - ✅ Pagination works (if implemented)

3. **Create/Update Operations:**
   - ✅ Validation errors display correctly
   - ✅ Duplicate edge errors show proper message
   - ✅ Self-loop prevention shows error

4. **Error Handling:**
   - ✅ Validation errors show field-level messages
   - ✅ Network errors handled gracefully
   - ✅ 409 conflicts show user-friendly messages

---

## 🚨 Breaking Changes

**These changes are BREAKING and will cause runtime errors if not fixed:**

1. `GET /api/knowledge-graph/nodes` - Response format changed
2. `GET /api/knowledge-graph/edges` - Response format changed
3. Error responses now include `errors` array for validation failures

**Impact:** 
- Frontend will try to use arrays directly but receive objects
- TypeScript types will be incorrect
- Error handling may not show validation details

---

## 📝 Quick Fix Template

For each file that uses list endpoints, apply this pattern:

```typescript
// OLD:
const { data: items = [] } = useQuery<Item[]>({
  queryKey: ["/api/knowledge-graph/nodes"],
  queryFn: async () => {
    const res = await apiRequest("GET", "/api/knowledge-graph/nodes");
    return res.json(); // Returns array
  },
});

// NEW:
const { data: response } = useQuery<{ nodes: Item[]; total: number; page: number; limit: number }>({
  queryKey: ["/api/knowledge-graph/nodes"],
  queryFn: async () => {
    const res = await apiRequest("GET", "/api/knowledge-graph/nodes");
    return res.json(); // Returns paginated object
  },
});

const items = response?.nodes ?? [];
```

---

*Last Updated: [Current Date]*
*Priority: HIGH - These changes are required for the frontend to work with the updated backend*

