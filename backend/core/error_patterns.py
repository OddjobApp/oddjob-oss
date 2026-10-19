"""
Standardized Error Handling Patterns
Consistent error handling utilities and patterns across the application
"""

import logging
from typing import Any, Dict, List, Optional, Callable, TypeVar, Union
from functools import wraps
from contextlib import contextmanager
import traceback
import asyncio
from datetime import datetime, timezone

from core.api_responses import ErrorDetail, HTTPResponseFactory
from core.structured_logging import get_structured_logger

logger = get_structured_logger("error_handling")

# Type variables for generic error handling
T = TypeVar('T')
E = TypeVar('E', bound=Exception)

class ErrorContext:
    """Context information for error handling."""

    def __init__(
        self,
        operation: str,
        user_id: Optional[str] = None,
        request_id: Optional[str] = None,
        resource: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.operation = operation
        self.user_id = user_id
        self.request_id = request_id
        self.resource = resource
        self.metadata = metadata or {}
        self.timestamp = datetime.now(timezone.utc)

    def to_dict(self) -> Dict[str, Any]:
        """Convert context to dictionary for logging."""
        return {
            "operation": self.operation,
            "user_id": self.user_id,
            "request_id": self.request_id,
            "resource": self.resource,
            "timestamp": self.timestamp.isoformat(),
            **self.metadata
        }


class ErrorHandler:
    """Centralized error handling with consistent patterns."""

    @staticmethod
    def handle_validation_error(
        errors: List[Dict[str, str]],
        context: Optional[ErrorContext] = None
    ) -> Dict[str, Any]:
        """Handle validation errors consistently."""
        context = context or ErrorContext("validation")

        logger.warning(
            f"Validation failed: {len(errors)} errors",
            extra={
                "error_count": len(errors),
                "validation_errors": errors,
                **context.to_dict()
            }
        )

        return HTTPResponseFactory.validation_error_response(errors).body

    @staticmethod
    def handle_business_logic_error(
        message: str,
        error_code: str = "BUSINESS_LOGIC_ERROR",
        context: Optional[ErrorContext] = None,
        status_code: int = 400
    ) -> Dict[str, Any]:
        """Handle business logic errors consistently."""
        context = context or ErrorContext("business_logic")

        logger.warning(
            f"Business logic error: {message}",
            extra={
                "error_code": error_code,
                "status_code": status_code,
                **context.to_dict()
            }
        )

        return HTTPResponseFactory.error_response(message, status_code).body

    @staticmethod
    def handle_system_error(
        error: Exception,
        context: Optional[ErrorContext] = None,
        include_traceback: bool = False
    ) -> Dict[str, Any]:
        """Handle system/unexpected errors consistently."""
        context = context or ErrorContext("system_error")

        error_details = {
            "error_type": type(error).__name__,
            "error_message": str(error),
            "module": getattr(error, '__module__', 'unknown')
        }

        if include_traceback:
            error_details["traceback"] = traceback.format_exc()

        logger.error(
            f"System error: {error}",
            exc_info=True,
            extra={
                "system_error": True,
                **error_details,
                **context.to_dict()
            }
        )

        return HTTPResponseFactory.error_response(
            "An unexpected error occurred",
            500
        ).body

    @staticmethod
    def handle_external_service_error(
        service: str,
        error: Exception,
        context: Optional[ErrorContext] = None
    ) -> Dict[str, Any]:
        """Handle external service errors consistently."""
        context = context or ErrorContext("external_service", resource=service)

        logger.error(
            f"External service error ({service}): {error}",
            exc_info=True,
            extra={
                "service": service,
                "external_error": True,
                **context.to_dict()
            }
        )

        return HTTPResponseFactory.error_response(
            f"Service temporarily unavailable: {service}",
            502
        ).body

    @staticmethod
    def handle_authentication_error(
        message: str = "Authentication required",
        context: Optional[ErrorContext] = None
    ) -> Dict[str, Any]:
        """Handle authentication errors consistently."""
        context = context or ErrorContext("authentication")

        logger.warning(
            f"Authentication error: {message}",
            extra=context.to_dict()
        )

        return HTTPResponseFactory.unauthorized_response(message).body

    @staticmethod
    def handle_authorization_error(
        message: str = "Insufficient permissions",
        context: Optional[ErrorContext] = None
    ) -> Dict[str, Any]:
        """Handle authorization errors consistently."""
        context = context or ErrorContext("authorization")

        logger.warning(
            f"Authorization error: {message}",
            extra=context.to_dict()
        )

        return HTTPResponseFactory.forbidden_response(message).body

    @staticmethod
    def handle_not_found_error(
        resource: str,
        identifier: Optional[str] = None,
        context: Optional[ErrorContext] = None
    ) -> Dict[str, Any]:
        """Handle resource not found errors consistently."""
        context = context or ErrorContext("resource_not_found", resource=resource)

        logger.info(
            f"Resource not found: {resource}" + (f" ({identifier})" if identifier else ""),
            extra=context.to_dict()
        )

        return HTTPResponseFactory.not_found_response(resource, identifier).body


# Decorator for consistent error handling in functions
def handle_errors(
    context_builder: Optional[Callable[..., ErrorContext]] = None,
    include_traceback: bool = False
) -> Callable:
    """
    Decorator to handle errors consistently in functions.

    Args:
        context_builder: Function to build error context
        include_traceback: Whether to include traceback in logs
    """
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def async_wrapper(*args, **kwargs) -> T:
            # Build context
            context = None
            if context_builder:
                try:
                    context = context_builder(*args, **kwargs)
                except:
                    context = ErrorContext(func.__name__)

            try:
                return await func(*args, **kwargs)
            except Exception as e:
                # Re-raise the exception after logging
                ErrorHandler.handle_system_error(e, context, include_traceback)
                raise

        @wraps(func)
        def sync_wrapper(*args, **kwargs) -> T:
            # Build context
            context = None
            if context_builder:
                try:
                    context = context_builder(*args, **kwargs)
                except:
                    context = ErrorContext(func.__name__)

            try:
                return func(*args, **kwargs)
            except Exception as e:
                # Re-raise the exception after logging
                ErrorHandler.handle_system_error(e, context, include_traceback)
                raise

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator


# Context manager for error handling in blocks of code
@contextmanager
def error_context(
    operation: str,
    user_id: Optional[str] = None,
    request_id: Optional[str] = None,
    resource: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
):
    """
    Context manager for consistent error handling in code blocks.

    Usage:
        with error_context("database_operation", user_id=user.id):
            # Your code here
            result = db.execute(query)
    """
    context = ErrorContext(operation, user_id, request_id, resource, metadata)

    try:
        yield context
    except Exception as e:
        ErrorHandler.handle_system_error(e, context)
        raise


# Utility functions for common error scenarios
def validate_required_fields(data: Dict[str, Any], required_fields: List[str]) -> List[Dict[str, str]]:
    """Validate that required fields are present in data."""
    errors = []
    for field in required_fields:
        if field not in data or data[field] is None or str(data[field]).strip() == "":
            errors.append({
                "field": field,
                "message": f"Field '{field}' is required"
            })
    return errors


def validate_field_types(data: Dict[str, Any], field_types: Dict[str, type]) -> List[Dict[str, str]]:
    """Validate field types in data."""
    errors = []
    for field, expected_type in field_types.items():
        if field in data and data[field] is not None:
            if not isinstance(data[field], expected_type):
                errors.append({
                    "field": field,
                    "message": f"Field '{field}' must be of type {expected_type.__name__}"
                })
    return errors


def safe_get(data: Dict[str, Any], key: str, default: Any = None) -> Any:
    """Safely get a value from a dictionary with error handling."""
    try:
        return data.get(key, default)
    except (AttributeError, TypeError):
        logger.warning(f"Invalid data structure when accessing key: {key}")
        return default


# Error recovery utilities
class ErrorRecovery:
    """Utilities for error recovery and fallback strategies."""

    @staticmethod
    async def with_retry(
        func: Callable[..., T],
        max_attempts: int = 3,
        delay: float = 1.0,
        backoff: float = 2.0,
        exceptions: tuple = (Exception,),
        context: Optional[ErrorContext] = None
    ) -> T:
        """
        Execute function with retry logic.

        Args:
            func: Function to execute
            max_attempts: Maximum number of attempts
            delay: Initial delay between attempts
            backoff: Backoff multiplier
            exceptions: Tuple of exceptions to catch
            context: Error context for logging
        """
        current_delay = delay
        last_exception = None

        for attempt in range(max_attempts):
            try:
                if asyncio.iscoroutinefunction(func):
                    return await func()
                else:
                    return func()
            except exceptions as e:
                last_exception = e

                if attempt < max_attempts - 1:
                    logger.warning(
                        f"Attempt {attempt + 1} failed, retrying in {current_delay}s: {e}",
                        extra=context.to_dict() if context else {}
                    )
                    await asyncio.sleep(current_delay)
                    current_delay *= backoff
                else:
                    logger.error(
                        f"All {max_attempts} attempts failed: {e}",
                        extra=context.to_dict() if context else {}
                    )

        raise last_exception

    @staticmethod
    def with_fallback(
        primary_func: Callable[..., T],
        fallback_func: Callable[..., T],
        exceptions: tuple = (Exception,),
        context: Optional[ErrorContext] = None
    ) -> T:
        """
        Execute primary function with fallback.

        Args:
            primary_func: Primary function to try
            fallback_func: Fallback function to use on failure
            exceptions: Tuple of exceptions to catch
            context: Error context for logging
        """
        try:
            if asyncio.iscoroutinefunction(primary_func):
                return asyncio.run(primary_func())
            else:
                return primary_func()
        except exceptions as e:
            logger.warning(
                f"Primary function failed, using fallback: {e}",
                extra=context.to_dict() if context else {}
            )

            try:
                if asyncio.iscoroutinefunction(fallback_func):
                    return asyncio.run(fallback_func())
                else:
                    return fallback_func()
            except Exception as fallback_error:
                logger.error(
                    f"Fallback function also failed: {fallback_error}",
                    extra=context.to_dict() if context else {}
                )
                raise fallback_error


# Global error handler instance
error_handler = ErrorHandler()
error_recovery = ErrorRecovery()