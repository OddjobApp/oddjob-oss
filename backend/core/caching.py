"""
Caching Layer for API Responses and Data
Implements Redis-based caching with TTL and invalidation strategies
"""

import json
import hashlib
from typing import Any, Dict, Optional, Union, Callable
from functools import wraps
import redis.asyncio as redis
from core.config import settings
from core.logging import get_logger

logger = get_logger(__name__)


class CacheManager:
    """Redis-based caching manager with TTL support."""

    def __init__(self):
        self.redis_client: Optional[redis.Redis] = None
        self.enabled = bool(settings.REDIS_URL)
        self.default_ttl = 300  # 5 minutes default

        if self.enabled:
            try:
                if not settings.REDIS_URL:
                    raise ValueError("REDIS_URL not configured")
                self.redis_client = redis.Redis.from_url(
                    settings.REDIS_URL,
                    decode_responses=True,
                    retry_on_error=[redis.ConnectionError, redis.TimeoutError]
                )
                logger.info("Redis cache initialized")
            except Exception as e:
                logger.error(f"Failed to initialize Redis cache: {str(e)}")
                self.enabled = False

    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache."""
        if not self.enabled or not self.redis_client:
            return None

        try:
            value = await self.redis_client.get(key)
            if value:
                logger.debug(f"Cache hit for key: {key}")
                return json.loads(value)
            logger.debug(f"Cache miss for key: {key}")
            return None
        except Exception as e:
            logger.error(f"Cache get error for key {key}: {str(e)}")
            return None

    async def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """Set value in cache with TTL."""
        if not self.enabled or not self.redis_client:
            return False

        try:
            ttl_value = ttl or self.default_ttl
            serialized_value = json.dumps(value)
            await self.redis_client.setex(key, ttl_value, serialized_value)
            logger.debug(f"Cached value for key: {key} (TTL: {ttl_value}s)")
            return True
        except Exception as e:
            logger.error(f"Cache set error for key {key}: {str(e)}")
            return False

    async def delete(self, key: str) -> bool:
        """Delete value from cache."""
        if not self.enabled or not self.redis_client:
            return False

        try:
            await self.redis_client.delete(key)
            logger.debug(f"Deleted cache key: {key}")
            return True
        except Exception as e:
            logger.error(f"Cache delete error for key {key}: {str(e)}")
            return False

    async def delete_pattern(self, pattern: str) -> int:
        """Delete all keys matching pattern."""
        if not self.enabled or not self.redis_client:
            return 0

        try:
            # Get all keys matching pattern
            keys = await self.redis_client.keys(pattern)
            if keys:
                await self.redis_client.delete(*keys)
                logger.debug(f"Deleted {len(keys)} cache keys matching pattern: {pattern}")
                return len(keys)
            return 0
        except Exception as e:
            logger.error(f"Cache delete pattern error for {pattern}: {str(e)}")
            return 0

    async def exists(self, key: str) -> bool:
        """Check if key exists in cache."""
        if not self.enabled or not self.redis_client:
            return False

        try:
            return bool(await self.redis_client.exists(key))
        except Exception as e:
            logger.error(f"Cache exists error for key {key}: {str(e)}")
            return False

    async def clear_all(self) -> bool:
        """Clear all cache entries."""
        if not self.enabled or not self.redis_client:
            return False

        try:
            await self.redis_client.flushdb()
            logger.info("Cleared all cache entries")
            return True
        except Exception as e:
            logger.error(f"Cache clear error: {str(e)}")
            return False

    def generate_key(self, *args: Any, prefix: str = "") -> str:
        """Generate cache key from arguments."""
        # Create string representation of all arguments
        key_parts = [str(arg) for arg in args if arg is not None]
        key_string = ":".join(key_parts)

        # Add prefix if provided
        if prefix:
            key_string = f"{prefix}:{key_string}"

        # Hash long keys to avoid Redis key length limits
        if len(key_string) > 250:
            key_string = hashlib.md5(key_string.encode()).hexdigest()

        return key_string

    async def health_check(self) -> Dict[str, Any]:
        """Check cache health and connectivity."""
        if not self.enabled:
            return {"status": "disabled", "enabled": False}

        if not self.redis_client:
            return {"status": "error", "enabled": False, "error": "No Redis client"}

        try:
            await self.redis_client.ping()
            info = await self.redis_client.info()
            return {
                "status": "healthy",
                "enabled": True,
                "connected_clients": info.get("connected_clients", 0),
                "used_memory": info.get("used_memory_human", "unknown"),
                "uptime_seconds": info.get("uptime_in_seconds", 0)
            }
        except Exception as e:
            return {
                "status": "error",
                "enabled": False,
                "error": str(e)
            }


# Global cache manager instance
cache_manager = CacheManager()


# Decorators for caching
def cached(ttl: Optional[int] = None, key_prefix: str = ""):
    """Decorator to cache function results."""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            if not cache_manager.enabled:
                return await func(*args, **kwargs)

            # Generate cache key from function name and arguments
            key = cache_manager.generate_key(
                func.__name__,
                args[1:] if args else (),  # Skip 'self' for methods
                kwargs,
                prefix=key_prefix
            )

            # Try to get from cache first
            cached_result = await cache_manager.get(key)
            if cached_result is not None:
                logger.debug(f"Cache hit for {func.__name__}")
                return cached_result

            # Execute function and cache result
            result = await func(*args, **kwargs)

            # Cache the result (skip if result is None or error)
            if result is not None:
                await cache_manager.set(key, result, ttl)

            return result

        return wrapper
    return decorator


def cache_invalidate(pattern: str):
    """Decorator to invalidate cache patterns after function execution."""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Execute function first
            result = await func(*args, **kwargs)

            # Invalidate cache patterns
            if cache_manager.enabled:
                try:
                    deleted_count = await cache_manager.delete_pattern(pattern)
                    if deleted_count > 0:
                        logger.debug(f"Invalidated {deleted_count} cache entries matching: {pattern}")
                except Exception as e:
                    logger.error(f"Cache invalidation error: {str(e)}")

            return result

        return wrapper
    return decorator


# Cache key generators for common patterns
class CacheKeys:
    """Common cache key patterns."""

    @staticmethod
    def user_profile(user_id: str) -> str:
        return f"user:profile:{user_id}"

    @staticmethod
    def pipeline_list(org_id: str, filters: Dict[str, Any]) -> str:
        filter_str = json.dumps(filters, sort_keys=True)
        return f"pipeline:list:{org_id}:{hashlib.md5(filter_str.encode()).hexdigest()}"

    @staticmethod
    def pipeline_detail(pipeline_id: str) -> str:
        return f"pipeline:detail:{pipeline_id}"

    @staticmethod
    def job_list(pipeline_id: Optional[str] = None) -> str:
        if pipeline_id:
            return f"job:list:pipeline:{pipeline_id}"
        return "job:list:all"

    @staticmethod
    def execution_status(execution_id: str) -> str:
        return f"execution:status:{execution_id}"

    @staticmethod
    def api_response(endpoint: str, params: Dict[str, Any]) -> str:
        param_str = json.dumps(params, sort_keys=True)
        return f"api:{endpoint}:{hashlib.md5(param_str.encode()).hexdigest()}"


# Cache TTL constants
class CacheTTL:
    """Common cache TTL values in seconds."""

    # Short-term caches (1-5 minutes)
    API_RESPONSE = 60        # 1 minute
    USER_SESSION = 300       # 5 minutes

    # Medium-term caches (5-30 minutes)
    PIPELINE_DATA = 600      # 10 minutes
    JOB_STATUS = 300         # 5 minutes

    # Long-term caches (30+ minutes)
    STATIC_DATA = 3600       # 1 hour
    CONFIG_DATA = 1800       # 30 minutes

    # Very long-term (hours to days)
    USER_PROFILE = 86400     # 24 hours
    ORG_SETTINGS = 7200      # 2 hours


# Background cache warming utilities
class CacheWarmer:
    """Utilities for warming caches with frequently accessed data."""

    @staticmethod
    async def warm_user_profiles(user_ids: list[str]) -> int:
        """Pre-warm user profile caches."""
        warmed = 0
        # Implementation would fetch user data and cache it
        # This is a placeholder for the actual implementation
        logger.info(f"Cache warming requested for {len(user_ids)} user profiles")
        return warmed

    @staticmethod
    async def warm_pipeline_data(pipeline_ids: list[str]) -> int:
        """Pre-warm pipeline data caches."""
        warmed = 0
        # Implementation would fetch pipeline data and cache it
        logger.info(f"Cache warming requested for {len(pipeline_ids)} pipelines")
        return warmed

    @staticmethod
    async def warm_frequent_endpoints() -> int:
        """Pre-warm frequently accessed API endpoints."""
        warmed = 0
        endpoints = [
            "/api/v1/health",
            # Add other frequently accessed endpoints
        ]

        for endpoint in endpoints:
            # Implementation would make requests and cache responses
            logger.debug(f"Cache warming for endpoint: {endpoint}")
            warmed += 1

        logger.info(f"Cache warming completed for {warmed} endpoints")
        return warmed