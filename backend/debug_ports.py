
import asyncio
import asyncpg
import os
from dotenv import load_dotenv

async def check_db(port):
    url = f"postgresql://postgres:postgres@localhost:{port}/oddjob"
    print(f"\nChecking port {port}...")
    try:
        conn = await asyncpg.connect(url, timeout=5)
        try:
            rows = await conn.fetch("SELECT platform, org_id FROM saas_connectors")
            print(f"  Connectors on {port}: {[{'p': r['platform'], 'o': r['org_id']} for r in rows]}")
            
            orgs = await conn.fetch("SELECT org_id, name FROM orgs")
            print(f"  Orgs on {port}: {[{'id': r['org_id'], 'n': r['name']} for r in orgs]}")
        finally:
            await conn.close()
    except Exception as e:
        print(f"  Error on {port}: {e}")

async def main():
    await check_db(5432)
    await check_db(5433)

if __name__ == "__main__":
    asyncio.run(main())
