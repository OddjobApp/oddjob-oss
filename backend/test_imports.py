
import sys

def test_import(module_name):
    try:
        print(f"Importing {module_name}...")
        __import__(module_name)
        print(f"✅ {module_name} imported")
    except Exception as e:
        print(f"❌ {module_name} failed: {e}")

modules = [
    "pydantic",
    "fastapi",
    "uvicorn",
    "httpx",
    "psutil",
    "openai",
    "anthropic",
    "sentence_transformers",
    "playwright",
    "bs4",
    "numpy",
    "pypdf",
    "jwt",
    "bcrypt",
    "aiohttp",
    "nltk",
    "google.generativeai",
    "asyncpg"
]

for m in modules:
    test_import(m)

print("All imports tested.")
