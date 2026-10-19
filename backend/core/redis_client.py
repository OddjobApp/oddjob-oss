"""
Redis Client Management
Centralized Redis client configuration and management
"""

import redis.asyncio as redis
from typing import Optional
from core.config import settings
from core.structured_logging import get_structured_logger

logger = get_structured_logger("redis_client")

# Global Redis client instance
_redis_client: Optional[redis.Redis] = None


def get_redis_client() -> redis.Redis:
    """Get or create Redis client instance."""
    global _redis_client

    if _redis_client is None:
        if not settings.REDIS_URL:
            raise ValueError("REDIS_URL environment variable is required")

        try:
            _redis_client = redis.Redis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                retry_on_error=[redis.ConnectionError, redis.TimeoutError],
                socket_connect_timeout=5,
                socket_timeout=5,
                health_check_interval=30
            )
            logger.info("Redis client initialized", extra={"redis_url": settings.REDIS_URL})
        except Exception as e:
            logger.error(f"Failed to initialize Redis client: {e}")
            raise

    return _redis_client


async def test_redis_connection() -> bool:
    """Test Redis connection."""
    try:
        client = get_redis_client()
        await client.ping()
        return True
    except Exception as e:
        logger.error(f"Redis connection test failed: {e}")
        return False


async def close_redis_connection() -> None:
    """Close Redis connection."""
    global _redis_client

    if _redis_client:
        await _redis_client.close()
        _redis_client = None
        logger.info("Redis connection closed")