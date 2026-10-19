import requests
import json
import os
import jwt
from dotenv import load_dotenv

load_dotenv()

# 1. Generate Token
secret = os.getenv("JWT_SECRET")
if not secret:
    raise SystemExit("Set JWT_SECRET to the server's signing secret.")

payload = {
    "user_id": "1",
    "username": "admin",
    "email": "admin@example.com",
    "roles": ["admin"],
    "permissions": ["all"],
    "type": "access",
    "iss": "oddjob-api"
}
token = jwt.encode(payload, secret, algorithm="HS256")
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# 2. Define Request Data
# We need a valid template ID. Let's assume 1 exists or the endpoint will return 404 (which is a valid response for connectivity check)
data = {
    "documentTemplateId": 1,
    "name": "Test API Agent",
    "description": "Created via python script",
    "config": {
        "documentTemplateId": 1,
        "formSchema": {"fields": []},
        "outputDataset": "",
        "variableMappings": {},
        "timeoutMinutes": 15,
        "retryOnFailure": False
    }
}

# 3. Test Python Direct
print("-" * 50)
print("Testing Python Backend (Port 8000)...")
try:
    resp = requests.post("http://localhost:8000/api/form-agents/", json=data, headers=headers)
    print(f"Status: {resp.status_code}")
    print(f"Response: {resp.text[:500]}")
except Exception as e:
    print(f"FAILED: {e}")

# 4. Test Node Proxy
print("-" * 50)
print("Testing Node Proxy (Port 5000)...")
try:
    resp = requests.post("http://localhost:5000/api/form-agents", json=data, headers=headers)
    print(f"Status: {resp.status_code}")
    print(f"Response: {resp.text[:500]}")
except Exception as e:
    print(f"FAILED: {e}")
