"""
Error Tracking Middleware
FastAPI middleware for automatic error tracking and monitoring
"""

import time
import json
from typing import Callable, Dict, Any, Optional
from contextlib import asynccontextmanager

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from core.error_tracking import error_tracker, ErrorSeverity, ErrorCategory
from core.structured_logging import tracer
from core.exceptions import OddjobException


class ErrorTrackingMiddleware(BaseHTTPMiddleware):
    """Middleware that automatically tracks errors and performance."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Extract request context
        request_id = tracer.generate_request_id()
        correlation_id = tracer.generate_correlation_id()

        # Set request context
        tracer.set_request_context(
            request_id=request_id,
            correlation_id=correlation_id,
            endpoint=str(request.url.path),
            method=request.method
        )

        # Extract additional context
        user_id = None
        if hasattr(request.state, 'user') and request.state.user:
            user_id = getattr(request.state.user, 'id', None) or getattr(request.state.user, 'user_id', None)

        ip_address = request.client.host if request.client else None

        start_time = time.time()

        try:
            # Process the request
            response = await call_next(request)

            # Track successful requests (optional - for performance monitoring)
            # We could add this if we want to track all requests, not just errors

            return response

        except OddjobException as e:
            # Handle known application exceptions
            duration = (time.time() - start_time) * 1000

            # Map exception types to error categories
            category_map = {
                'ValidationError': ErrorCategory.VALIDATION,
                'AuthenticationError': ErrorCategory.AUTHENTICATION,
                'AuthorizationError': ErrorCategory.AUTHORIZATION,
                'ExternalServiceError': ErrorCategory.EXTERNAL_SERVICE,
                'ResourceNotFoundError': ErrorCategory.PROCESSING,
                'ConfigurationError': ErrorCategory.CONFIGURATION,
                'ProcessingError': ErrorCategory.PROCESSING,
                'RateLimitError': ErrorCategory.RATE_LIMIT
            }

            category = category_map.get(type(e).__name__, ErrorCategory.UNKNOWN)

            # Map status codes to severity
            severity_map = {
                400: ErrorSeverity.LOW,      # Bad Request
                401: ErrorSeverity.MEDIUM,   # Unauthorized
                403: ErrorSeverity.MEDIUM,   # Forbidden
                404: ErrorSeverity.LOW,      # Not Found
                422: ErrorSeverity.LOW,      # Unprocessable Entity
                429: ErrorSeverity.MEDIUM,   # Too Many Requests
                500: ErrorSeverity.HIGH,     # Internal Server Error
                502: ErrorSeverity.HIGH,     # Bad Gateway
                503: ErrorSeverity.CRITICAL  # Service Unavailable
            }

            severity = severity_map.get(e.status_code, ErrorSeverity.MEDIUM)

            # Track the error
            error_tracker.track_error(
                error=e,
                severity=severity,
                category=category,
                context={
                    'endpoint': str(request.url.path),
                    'method': request.method,
                    'user_id': user_id,
                    'request_id': request_id,
                    'correlation_id': correlation_id,
                    'ip_address': ip_address,
                    'status_code': e.status_code,
                    'metadata': {
                        'user_agent': request.headers.get('user-agent'),
                        'content_type': request.headers.get('content-type'),
                        'response_time_ms': duration
                    }
                }
            )

            # Return error response
            return JSONResponse(
                status_code=e.status_code,
                content=e.to_dict()
            )

        except Exception as e:
            # Handle unexpected exceptions
            duration = (time.time() - start_time) * 1000

            # Track the error
            error_tracker.track_error(
                error=e,
                severity=ErrorSeverity.HIGH,
                category=ErrorCategory.SYSTEM,
                context={
                    'endpoint': str(request.url.path),
                    'method': request.method,
                    'user_id': user_id,
                    'request_id': request_id,
                    'correlation_id': correlation_id,
                    'ip_address': ip_address,
                    'status_code': 500,
                    'metadata': {
                        'user_agent': request.headers.get('user-agent'),
                        'content_type': request.headers.get('content-type'),
                        'response_time_ms': duration
                    }
                }
            )

            # Return generic error response
            return JSONResponse(
                status_code=500,
                content={
                    "error": {
                        "code": "INTERNAL_ERROR",
                        "message": "An unexpected error occurred",
                        "details": {}
                    }
                }
            )

        finally:
            # Clear request context
            tracer.clear_request_context()


class ErrorBoundaryMiddleware(BaseHTTPMiddleware):
    """Middleware that catches any unhandled errors and ensures they're tracked."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        try:
            return await call_next(request)
        except Exception as e:
            # This should rarely happen since ErrorTrackingMiddleware should catch most errors
            # But this is a safety net for any middleware or routing errors

            request_id = tracer.generate_request_id()
            correlation_id = tracer.generate_correlation_id()

            error_tracker.track_error(
                error=e,
                severity=ErrorSeverity.CRITICAL,
                category=ErrorCategory.SYSTEM,
                context={
                    'endpoint': str(request.url.path),
                    'method': request.method,
                    'request_id': request_id,
                    'correlation_id': correlation_id,
                    'ip_address': request.client.host if request.client else None,
                    'metadata': {
                        'user_agent': request.headers.get('user-agent'),
                        'middleware_level': 'boundary'
                    }
                }
            )

            # Return critical error response
            return JSONResponse(
                status_code=500,
                content={
                    "error": {
                        "code": "CRITICAL_ERROR",
                        "message": "A critical system error occurred",
                        "details": {}
                    }
                }
            )


# Utility functions for manual error tracking
def track_api_error(
    error: Exception,
    request: Request,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    category: ErrorCategory = ErrorCategory.UNKNOWN
) -> None:
    """Manually track an API error."""
    user_id = None
    if hasattr(request.state, 'user') and request.state.user:
        user_id = getattr(request.state.user, 'id', None) or getattr(request.state.user, 'user_id', None)

    error_tracker.track_error(
        error=error,
        severity=severity,
        category=category,
        context={
            'endpoint': str(request.url.path),
            'method': request.method,
            'user_id': user_id,
            'request_id': getattr(request.state, 'request_id', None),
            'correlation_id': getattr(request.state, 'correlation_id', None),
            'ip_address': request.client.host if request.client else None,
            'metadata': {
                'user_agent': request.headers.get('user-agent'),
                'content_type': request.headers.get('content-type')
            }
        }
    )


@asynccontextmanager
async def error_tracking_context(operation_name: str, context: Optional[Dict[str, Any]] = None):
    """Async context manager for tracking errors in background operations."""
    operation_context = context or {}

    try:
        yield
    except Exception as e:
        error_tracker.track_error(
            error=e,
            severity=ErrorSeverity.MEDIUM,
            category=ErrorCategory.PROCESSING,
            context={
                'operation': operation_name,
                **operation_context
            }
        )
        raise