"""
Rate Limiting Implementation
Protect API endpoints from abuse with configurable rate limits
"""

import time
import asyncio
from typing import Dict, List, Optional, Tuple, Union, Any
from collections import defaultdict, deque
from fastapi import Request, HTTPException, status
from core.config import settings
from core.logging import get_logger

logger = get_logger(__name__)


class RateLimiter:
    """In-memory rate limiter with sliding window."""

    def __init__(self, requests_per_window: int = 100, window_seconds: int = 60):
        self.requests_per_window = requests_per_window
        self.window_seconds = window_seconds
        self.requests: Dict[str, deque] = defaultdict(deque)

    def is_allowed(self, key: str) -> Tuple[bool, Optional[float]]:
        """
        Check if request is allowed for the given key.

        Returns:
            Tuple of (is_allowed, retry_after_seconds)
        """
        now = time.time()
        request_times = self.requests[key]

        # Remove old requests outside the window
        while request_times and request_times[0] < now - self.window_seconds:
            request_times.popleft()

        # Check if under limit
        if len(request_times) < self.requests_per_window:
            request_times.append(now)
            return True, None

        # Calculate retry time
        if request_times:
            oldest_request = request_times[0]
            retry_after = self.window_seconds - (now - oldest_request)
            return False, max(0, retry_after)

        return False, self.window_seconds


class RateLimitStore:
    """Centralized rate limiting store with multiple limiters."""

    def __init__(self):
        self.limiters: Dict[str, RateLimiter] = {}

        # Define rate limits for different endpoints
        self._setup_limits()

    def _setup_limits(self):
        """Configure rate limits for different endpoints."""
        # General API limits
        self.limiters['api_general'] = RateLimiter(requests_per_window=100, window_seconds=60)

        # Embedding endpoints (resource intensive)
        self.limiters['api_embeddings'] = RateLimiter(requests_per_window=50, window_seconds=60)

        # Scraping endpoints (external requests)
        self.limiters['api_scraping'] = RateLimiter(requests_per_window=20, window_seconds=60)

        # File upload endpoints
        self.limiters['api_uploads'] = RateLimiter(requests_per_window=10, window_seconds=60)

        # Health checks (should be unlimited or high limit)
        self.limiters['api_health'] = RateLimiter(requests_per_window=1000, window_seconds=60)

        # Authentication endpoints
        self.limiters['api_auth'] = RateLimiter(requests_per_window=10, window_seconds=300)  # 10 per 5 minutes

    def check_limit(self, limit_type: str, key: str) -> Tuple[bool, Optional[float]]:
        """Check if request is allowed for the given limit type and key."""
        limiter = self.limiters.get(limit_type)
        if not limiter:
            # Default to general limit if type not found
            limiter = self.limiters['api_general']

        return limiter.is_allowed(key)

    def get_limits_info(self) -> Dict[str, Dict[str, int]]:
        """Get information about all configured limits."""
        return {
            name: {
                'requests_per_window': limiter.requests_per_window,
                'window_seconds': limiter.window_seconds
            }
            for name, limiter in self.limiters.items()
        }


# Global rate limit store instance
rate_limit_store = RateLimitStore()


def get_client_identifier(request: Any) -> str:
    """Generate a unique identifier for the client."""
    # Use IP address as primary identifier
    client_ip = getattr(request.client, 'host', 'unknown') if hasattr(request, 'client') and request.client else 'unknown'

    # For authenticated requests, could also use user ID
    # user_id = getattr(request.state, 'user_id', None)
    # if user_id:
    #     return f"user:{user_id}"

    return f"ip:{client_ip}"


def get_endpoint_limit_type(path: str, method: str) -> str:
    """Determine the rate limit type based on endpoint and method."""
    path_lower = path.lower()

    if '/health' in path_lower:
        return 'api_health'
    elif '/embed' in path_lower:
        return 'api_embeddings'
    elif '/scrape' in path_lower or '/pdf' in path_lower:
        return 'api_scraping'
    elif method == 'POST' and ('/upload' in path_lower or 'file' in path_lower):
        return 'api_uploads'
    elif '/auth' in path_lower or '/login' in path_lower:
        return 'api_auth'
    else:
        return 'api_general'


class RateLimitMiddleware:
    """Middleware to enforce rate limiting on API endpoints."""

    def __init__(self, app, exclude_paths: Optional[List[str]] = None):
        self.app = app
        self.exclude_paths = exclude_paths or ['/docs', '/redoc', '/openapi.json']

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Skip rate limiting for excluded paths
        path = scope.get("path", "")
        if any(excluded in path for excluded in self.exclude_paths):
            await self.app(scope, receive, send)
            return

        # Create a mock request object for identifier generation
        class MockRequest:
            def __init__(self, scope):
                self.scope = scope
                # Extract client info from ASGI scope
                client_info = scope.get('client', ['unknown', 0])
                self.client = type('Client', (), {'host': client_info[0]})()

        mock_request = MockRequest(scope)
        client_id = get_client_identifier(mock_request)
        method = scope.get("method", "GET")
        limit_type = get_endpoint_limit_type(path, method)

        # Check rate limit
        allowed, retry_after = rate_limit_store.check_limit(limit_type, client_id)

        if not allowed:
            # Rate limit exceeded
            logger.warning(
                f"Rate limit exceeded for {client_id} on {method} {path}",
                extra={
                    "client_id": client_id,
                    "method": method,
                    "path": path,
                    "limit_type": limit_type,
                    "retry_after": retry_after
                }
            )

            await self._send_rate_limit_error(send, retry_after or 60)
            return

        # Add rate limit headers to response
        original_send = send

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                # Add rate limit headers
                headers = list(message.get("headers", []))
                limits_info = rate_limit_store.get_limits_info()
                limit_info = limits_info.get(limit_type, {})

                headers.extend([
                    [b'x-ratelimit-limit', str(limit_info.get('requests_per_window', 100)).encode()],
                    [b'x-ratelimit-window', str(limit_info.get('window_seconds', 60)).encode()],
                    [b'x-ratelimit-remaining', b'unknown'],  # Would need per-client tracking
                ])

                message["headers"] = headers

            await original_send(message)

        await self.app(scope, receive, send_with_headers)

    async def _send_rate_limit_error(self, send, retry_after: float):
        """Send rate limit exceeded error response."""
        import json

        await send({
            'type': 'http.response.start',
            'status': status.HTTP_429_TOO_MANY_REQUESTS,
            'headers': [
                [b'content-type', b'application/json'],
                [b'retry-after', str(int(retry_after)).encode()],
                [b'x-ratelimit-reset', str(int(time.time() + retry_after)).encode()],
            ],
        })
        await send({
            'type': 'http.response.body',
            'body': json.dumps({
                'error': {
                    'code': 'RATE_LIMIT_EXCEEDED',
                    'message': 'Too many requests. Please try again later.',
                    'retry_after': int(retry_after)
                }
            }).encode('utf-8'),
        })


# Utility functions for manual rate limiting in route handlers
async def check_rate_limit(request: Request, limit_type: str = 'api_general') -> None:
    """Manually check rate limit in route handlers."""
    client_id = get_client_identifier(request)
    allowed, retry_after = rate_limit_store.check_limit(limit_type, client_id)

    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
            headers={"Retry-After": str(int(retry_after or 60))}
        )