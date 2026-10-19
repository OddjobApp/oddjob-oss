# ShelfLife App - MCP Testing Protocol

## Prerequisites
1. Start the Oddjob server: `npm run dev`
2. Ensure Redis is running
3. Verify Docker is available (for container builds)

## Phase 1: Forge the App

### Step 1: List Available Blueprints
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "list_blueprints",
      "arguments": {}
    }
  }'
```

### Step 2: Forge the ShelfLife App
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "forge_app",
      "arguments": {
        "blueprint": "analytics-dashboard",
        "name": "ShelfLife",
        "slug": "shelflife-mcp",
        "description": "A streamlined visual expiration dashboard for tracking food items. Prioritized view of what needs to be eaten before it spoils.",
        "systemPrompt": "Build a food inventory app called ShelfLife. Features: 1) Add items with Name, Category (Fridge/Freezer/Pantry), and Expiry Date 2) Gallery view showing all inventory items as cards 3) Color-coded by expiration: Red (<24h), Yellow (2-3 days), Green (4+ days) 4) Category filters 5) Empty state graphic 6) Date pickers and dropdowns for input 7) 'Consumed' button to remove items. Design: Forest Green (#2D5A27) primary, Soft Gray (#F8F9FA) background, Alert Red (#FF4D4D) for urgent. Bottom nav with Home, Add Item, Settings."
      }
    }
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "jobId": "forge-shelflife-mcp-<timestamp>",
  "slug": "shelflife-mcp",
  "message": "App 'ShelfLife' forge request accepted. Monitor status with jobId: ..."
}
```

### Step 3: Monitor Forge Status
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get_forge_status",
      "arguments": {
        "jobId": "forge-shelflife-mcp-<timestamp>"
      }
    }
  }'
```

Repeat every 10-30 seconds until status is "completed" or "failed".

---

## Phase 2: Validate & Harden

### Step 4: Validate Workspace
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "forge_validate_workspace",
      "arguments": {
        "slug": "shelflife-mcp"
      }
    }
  }'
```

**Expected:** Returns `{ valid: true }` or a list of issues to fix.

### Step 5: Sanitize Dependencies (if needed)
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "forge_sanitize_deps",
      "arguments": {
        "slug": "shelflife-mcp",
        "blueprintSlug": "analytics-dashboard"
      }
    }
  }'
```

### Step 6: Inject Build Config
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 6,
    "method": "tools/call",
    "params": {
      "name": "forge_inject_build_config",
      "arguments": {
        "slug": "shelflife-mcp"
      }
    }
  }'
```

---

## Phase 3: Inspect & Iterate

### Step 7: List Files
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 7,
    "method": "tools/call",
    "params": {
      "name": "studio_list_files",
      "arguments": {
        "slug": "shelflife-mcp"
      }
    }
  }'
```

### Step 8: Read Key Files
Check `pages/index.tsx` and components:
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 8,
    "method": "tools/call",
    "params": {
      "name": "studio_read_file",
      "arguments": {
        "slug": "shelflife-mcp",
        "filePath": "pages/index.tsx"
      }
    }
  }'
```

### Step 9: Fix Issues (if needed)
Edit files directly:
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 9,
    "method": "tools/call",
    "params": {
      "name": "forge_edit_file",
      "arguments": {
        "slug": "shelflife-mcp",
        "filePath": "components/ExpiryCard.tsx",
        "content": "// Fixed component code here..."
      }
    }
  }'
```

---

## Phase 4: AI Enhancement

### Step 10: Enhance with Natural Language
```bash
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 10,
    "method": "tools/call",
    "params": {
      "name": "studio_enhance_app",
      "arguments": {
        "appId": <app-id-from-forge-status>,
        "instruction": "Add a 'Recipe Search' button to Red items that opens a web search"
      }
    }
  }'
```

---

## Phase 5: Testing Checklist

### ✅ Test 1: Date Calculation Logic
```bash
# Check pages/index.tsx contains:
# - Date difference calculation
# - Color logic (Red <24h, Yellow 2-3d, Green 4+d)
# - Proper date-fns or native Date usage
```

### ✅ Test 2: Performance with 50 Items
```bash
# Use forge_edit_file to create test data
# Or enhance_app: "Add 50 sample food items with various expiry dates"
# Verify UI doesn't lag
```

### ✅ Test 3: Responsive Design
```bash
# Check for:
# - Tailwind responsive classes (sm:, md:, lg:)
# - Mobile-first layout
# - Bottom navigation bar
```

### ✅ Test 4: Add Item Efficiency
```bash
# Verify:
# - Date picker component exists
# - Category dropdown exists
# - Form validation
# - Quick-add flow under 10 seconds
```

---

## Troubleshooting

### Issue: Forge Failed (0 files generated)
**Fix:** Check `get_forge_status` logs. If AI returned conversational text:
1. The code has been hardened to auto-retry
2. Check logs for "Architect JSON parse failed"
3. Try with lower granularity or simpler system prompt

### Issue: 429 Rate Limit
**Fix:** The code now auto-retries with exponential backoff (5s, 10s, 20s). Wait and retry.

### Issue: JSON Parse Error
**Fix:** The `tryFixJson` utility auto-repairs common errors. Check logs for applied fixes.

### Issue: Missing Dependencies
**Fix:** Run `forge_sanitize_deps` then `forge_npm_command`:
```bash
# npm install
curl -X POST http://localhost:3001/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 11,
    "method": "tools/call",
    "params": {
      "name": "forge_npm_command",
      "arguments": {
        "slug": "shelflife-mcp",
        "command": "install"
      }
    }
  }'
```

---

## Summary of Hardening Applied

1. **Rate Limit Handling** - `executeWithBackoff` with exponential retry
2. **JSON Parsing** - Multi-strategy extraction + `tryFixJson` auto-repair
3. **Error Context** - Detailed logging with position context
4. **Build Hardening** - `sanitize_deps`, `inject_build_config`, `validate_workspace`
5. **MCP Integration** - All forge tools exposed via MCP protocol
