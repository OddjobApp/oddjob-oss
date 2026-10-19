import os
import jwt
import sys
from dotenv import load_dotenv

# Load .env to get the secret used by Node (JWT_SECRET)
load_dotenv()

secret = os.getenv("JWT_SECRET")
if not secret:
    raise SystemExit("Set JWT_SECRET to the server's signing secret.")

# Create a token that looks like what Node generates
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
print(token)
