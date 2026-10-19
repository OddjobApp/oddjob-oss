
import asyncio
import asyncpg
import os
from dotenv import load_dotenv

async def main():
    load_dotenv()
    DATABASE_URL = os.getenv("DATABASE_URL")
    if not DATABASE_URL:
        print("DATABASE_URL not found")
        return

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'saas_connectors'
        """)
        for row in rows:
            print(f"Column: {row['column_name']}, Type: {row['data_type']}")
            
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
