
import json

data = {"key": "value"}
try:
    print("Testing json.loads on a dict...")
    json.loads(data)
except TypeError as e:
    print(f"Caught expected TypeError: {e}")

# This is what saas_repository.py is doing:
# row['config'] is a dict (from asyncpg jsonb)
# config_data = json.loads(row['config']) -> raised TypeError
