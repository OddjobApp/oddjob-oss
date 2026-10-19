import os
import jwt
from dotenv import load_dotenv

load_dotenv()

# Simulate Node generating a token
node_secret = os.getenv("JWT_SECRET")
print(f"Node Secret (from .env): {node_secret[:5]}...")

payload = {"user_id": "1", "username": "admin", "type": "access"}
token = jwt.encode(payload, node_secret, algorithm="HS256")
print(f"Generated Token: {token[:10]}...")

# Simulate Python decoding it with default secret
python_default_secret = "your-secret-key-change-in-production"
print(f"Python Default Secret: {python_default_secret[:5]}...")

try:
    decoded = jwt.decode(token, python_default_secret, algorithms=["HS256"])
    print("SUCCESS: Python decoded the token!")
except Exception as e:
    print(f"FAILURE: Python failed to decode: {e}")

# Check if Python would read JWT_SECRET if we modified config
print(f"os.getenv('JWT_SECRET'): {os.getenv('JWT_SECRET')[:5]}...")
print(f"os.getenv('JWT_SECRET_KEY'): {os.getenv('JWT_SECRET_KEY')}")
