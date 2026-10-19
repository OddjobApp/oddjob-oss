
import asyncio
import asyncpg
import os
import json
from dotenv import load_dotenv

async def main():
    load_dotenv()
    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        print("DATABASE_URL not found")
        return

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch("SELECT id, org_id, platform, status, updated_at FROM saas_connectors")
        print(f"Found {len(rows)} connectors:")
        for row in rows:
            print(f"ID: {row['id']}, Org: {row['org_id']}, Platform: {row['platform']}, Status: {row['status']}, Updated: {row['updated_at']}")
            
        orgs = await conn.fetch("SELECT org_id as id, name FROM orgs")
        print("\nOrganizations (orgs table):")
        for org in orgs:
            print(f"ID: {org['id']}, Name: {org['name']}")
            
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
