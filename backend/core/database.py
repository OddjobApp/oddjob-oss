
import asyncpg
import os
from typing import AsyncGenerator
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

# Global pool instance
_pool: asyncpg.Pool | None = None

async def get_pool() -> asyncpg.Pool:
    """Get the database connection pool, initializing it if necessary."""
    global _pool
    if _pool is None:
        DATABASE_URL = os.getenv("DATABASE_URL")
        if not DATABASE_URL:
            raise ValueError("DATABASE_URL environment variable is required")
        _pool = await asyncpg.create_pool(DATABASE_URL)
    return _pool

async def get_db() -> AsyncGenerator[asyncpg.Connection, None]:
    """Dependency for getting a database connection from the pool."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn

async def close_pool():
    """Close the database connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
