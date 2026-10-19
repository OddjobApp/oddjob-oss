import json
import re

collection = {
    "info": {
        "name": "Oddjob API",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    "item": [],
    "variable": [
        {"key": "baseUrl", "value": "http://localhost:5000", "type": "string"}
    ]
}

folders = {
    "Auth": ["/api/login", "/api/logout", "/api/register", "/api/user", "/api/csrf-token"],
    "Jobs": ["/api/jobs"],
    "Pipelines": ["/api/pipelines", "/api/pipeline-executions"],
    "Schedules": ["/api/schedules", "/api/scheduled-jobs", "/api/schedule-triggers"],
    "Credentials": ["/api/credentials"],
    "Users": ["/api/users"],
    "Admin": ["/api/admin", "/api/org-settings", "/api/orgs", "/api/org-settings"],
    "Knowledge": ["/api/knowledge", "/api/rag-assets", "/api/knowledge-graph", "/api/knowledge-documents"],
    "Analytics": ["/api/analytics", "/api/dashboard"],
    "External": ["/api/external"],
    "Alerts": ["/api/alerts"],
    "Forms": ["/api/forms"],
    "System": ["/api/system", "/api/settings"],
}

folder_items = {k: [] for k in folders}
folder_items["Other"] = []

def get_folder(path):
    for f, prefixes in folders.items():
        for p in prefixes:
            if path.startswith(p):
                return f
    return "Other"

routes = []

# Parse routes_list.txt
try:
    with open("routes_list.txt", "r") as f:
        for line in f:
            m = re.search(r'app\.(get|post|put|delete|patch)\("([^"]+)"', line)
            if m:
                routes.append({"method": m.group(1).upper(), "path": m.group(2)})
except FileNotFoundError:
    print("Error: routes_list.txt not found")
    exit(1)

# Add specs routes
specs = [
    ("GET", "/api/admin/specs"),
    ("POST", "/api/admin/specs"),
    ("GET", "/api/admin/specs/:id"),
    ("PUT", "/api/admin/specs/:id"),
    ("POST", "/api/admin/specs/:id/access"),
    ("GET", "/api/admin/specs/:id/access"),
    ("PUT", "/api/admin/specs/:id/access/:orgId"),
    ("GET", "/api/orgs/:orgId/available-specs"),
    ("GET", "/api/orgs/:orgId/specs/:specId"),
    ("DELETE", "/api/admin/specs/:id")
]
for m, p in specs:
    routes.append({"method": m, "path": p})

# Sort routes by path
routes.sort(key=lambda x: x["path"])

for r in routes:
    folder = get_folder(r["path"])
    
    # Body logic
    body = {}
    if r["method"] in ["POST", "PUT", "PATCH"]:
        body = {"mode": "raw", "raw": "{}", "options": {"raw": {"language": "json"}}}
        # Add basic examples
        if r["path"] == "/api/login":
            body["raw"] = json.dumps({"username": "admin", "password": "password"}, indent=2)
        elif r["path"] == "/api/register":
            body["raw"] = json.dumps({"username": "newuser", "password": "password", "email": "test@example.com"}, indent=2)
        elif r["path"] == "/api/jobs":
            body["raw"] = json.dumps({
                "name": "New Job",
                "type": "shell",
                "tool": "None",
                "config": {"executable": "echo", "parameters": "hello"}
            }, indent=2)
        elif r["path"] == "/api/pipelines":
            body["raw"] = json.dumps({
                "name": "New Pipeline",
                "triggerType": "manual"
            }, indent=2)
        elif r["path"] == "/api/credentials":
            body["raw"] = json.dumps({
                "name": "New Credential",
                "type": "api_key",
                "envVarName": "TEST_KEY"
            }, indent=2)
        elif r["path"] == "/api/schedules":
            body["raw"] = json.dumps({
                "name": "New Schedule",
                "pattern": 1,
                "patternString": {}
            }, indent=2)
        elif r["path"] == "/api/scheduled-jobs":
            body["raw"] = json.dumps({
                "name": "New Scheduled Job",
                "jobId": 1,
                "scheduleId": 1
            }, indent=2)
        elif r["path"].startswith("/api/admin/organizations"):
             body["raw"] = json.dumps({
                "name": "New Organization"
            }, indent=2)
    
    item = {
        "name": f"{r['method']} {r['path']}",
        "request": {
            "method": r["method"],
            "url": {
                "raw": "{{baseUrl}}" + r["path"],
                "host": ["{{baseUrl}}"],
                "path": r["path"].strip("/").split("/")
            },
            "header": [{"key": "Content-Type", "value": "application/json"}]
        }
    }
    if body:
        item["request"]["body"] = body

    folder_items[folder].append(item)

# Build structure
for folder_name in sorted(folder_items.keys()):
    items = folder_items[folder_name]
    if items:
        collection["item"].append({
            "name": folder_name,
            "item": items
        })

print(json.dumps(collection, indent=2))
