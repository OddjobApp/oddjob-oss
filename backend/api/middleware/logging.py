"""
Logging Middleware
Request/response logging with performance metrics
"""

import time
import uuid
from typing import Callable
from fastapi import Request, Response
from fastapi.responses import JSONResponse

from core.logging import get_logger

logger = get_logger(__name__)


class LoggingMiddleware:
    """Middleware for logging HTTP requests and responses."""

    def __init__(self, app: Callable):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Generate request ID
        request_id = str(uuid.uuid4())[:8]

        # Start timing
        start_time = time.time()

        # Create request logger with extra context
        request_logger = get_logger(f"request.{request_id}")

        # Log request
        method = scope.get("method", "UNKNOWN")
        path = scope.get("path", "UNKNOWN")
        query = scope.get("query_string", b"").decode("utf-8", errors="ignore")

        request_logger.info(
            f"→ {method} {path}" + (f"?{query}" if query else ""),
            extra={"request_id": request_id}
        )

        # Store request ID in scope for handlers
        scope["request_id"] = request_id

        # Process request
        try:
            await self.app(scope, receive, send)
        except Exception as e:
            # Log error
            duration = time.time() - start_time
            request_logger.error(
                f"✗ {method} {path} - {type(e).__name__}: {str(e)} ({duration:.3f}s)",
                extra={"request_id": request_id, "error": str(e), "duration": duration}
            )
            raise
        else:
            # Request completed successfully (response already sent)
            duration = time.time() - start_time
            request_logger.info(
                f"✓ {method} {path} ({duration:.3f}s)",
                extra={"request_id": request_id, "duration": duration}
            )


async def log_request_middleware(request: Request, call_next):
    """Alternative middleware function for FastAPI."""
    request_id = str(uuid.uuid4())[:8]

    # Add request ID to request state
    request.state.request_id = request_id

    start_time = time.time()

    # Log request
    logger.info(
        f"→ {request.method} {request.url.path}",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "query": str(request.url.query),
            "user_agent": request.headers.get("user-agent"),
            "ip": request.client.host if request.client else None
        }
    )

    try:
        response = await call_next(request)

        # Log response
        duration = time.time() - start_time
        logger.info(
            f"✓ {request.method} {request.url.path} → {response.status_code} ({duration:.3f}s)",
            extra={
                "request_id": request_id,
                "status_code": response.status_code,
                "duration": duration,
                "content_length": response.headers.get("content-length")
            }
        )

        return response

    except Exception as e:
        duration = time.time() - start_time
        logger.error(
            f"✗ {request.method} {request.url.path} → ERROR ({duration:.3f}s): {str(e)}",
            extra={
                "request_id": request_id,
                "error": str(e),
                "error_type": type(e).__name__,
                "duration": duration
            }
        )
        raise