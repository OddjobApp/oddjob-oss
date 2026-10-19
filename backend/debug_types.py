
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
        rows = await conn.fetch("SELECT platform, config, credentials FROM saas_connectors")
        for row in rows:
            print(f"Platform: {row['platform']}")
            print(f"  Config type: {type(row['config'])}")
            print(f"  Config repr: {repr(row['config'])}")
            
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
