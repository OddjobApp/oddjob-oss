# Debugging Save Changes Button

## Current Status
- PATCH route exists in code (line 366 in server/routes.ts)
- Route is compiled in dist/server/routes.js
- Button has click handler with debugging
- Mutation has success/error handlers

## Steps to Debug

### 1. Restart Server (CRITICAL)
The server MUST be restarted to pick up the PATCH route:
```bash
# Stop server (Ctrl+C)
npm run dev
```

### 2. Test PATCH Endpoint Directly
```bash
curl -X PATCH http://localhost:5000/api/jobs/10 \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Save"}' \
  -v
```

**Expected:** Should return JSON with updated job
**If HTML returned:** Route not registered - server needs restart

### 3. Check Browser Console
When clicking "Save Changes", you should see:
1. "Save button clicked"
2. "handleSave called"
3. "editedJob:" (shows current edited job state)
4. "job:" (shows original job)
5. "Basic updates:" (shows what fields changed)
6. "Saving job updates:" (shows validated data)
7. "Calling updateMutation.mutate..."
8. "Sending PATCH request to:" (shows URL and data)
9. Either:
   - "Update successful:" (success)
   - "Update request failed:" (error)

### 4. Check Server Terminal
When clicking "Save Changes", you should see:
1. "PATCH /api/jobs/10" with request body
2. Either:
   - "Job 10 updated successfully"
   - "Error updating job:" (error message)

### 5. Common Issues

#### Issue: "No changes" toast appears
**Cause:** Updates object is empty
**Fix:** Make sure you actually changed a field

#### Issue: "Validation failed" in console
**Cause:** Data doesn't match schema
**Fix:** Check console for specific validation errors

#### Issue: "Update request failed" in console
**Cause:** API request failed
**Fix:** Check network tab for HTTP status and error message

#### Issue: No console logs appear
**Cause:** Button click not registered
**Fix:** Check if button is disabled or if there's a JavaScript error

#### Issue: Server returns HTML instead of JSON
**Cause:** Route not registered
**Fix:** Restart server with `npm run dev`

## Expected Flow

1. User clicks "Edit" → `isEditing` becomes `true`
2. User makes changes → `editedJob` state updates
3. User clicks "Save Changes" → `handleSave()` called
4. Validation runs → `updateJobSchema.safeParse(updates)`
5. If valid → `updateMutation.mutate(validation.data)` called
6. API request sent → `PATCH /api/jobs/10`
7. Server processes → Updates database
8. Response received → `onSuccess` callback
9. UI updates → `setIsEditing(false)`, toast shown, queries invalidated

## Next Steps

1. Restart server
2. Open browser console (F12)
3. Try to save
4. Share all console output
5. Share server terminal output

