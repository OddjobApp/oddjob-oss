"""
Custom Exception Classes
Structured error handling for the application

Error codes are aligned with shared/schema/errors.ts for consistency
across the TypeScript server and Python backend.
"""

from typing import Any, Dict, Optional


# Error codes aligned with shared/schema/errors.ts
class ErrorCode:
    """Error codes matching the TypeScript shared schema."""
    # Validation Errors (400)
    VALIDATION_FAILED = "VALIDATION_FAILED"
    INVALID_INPUT = "INVALID_INPUT"
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD"
    INVALID_FORMAT = "INVALID_FORMAT"

    # Authentication Errors (401)
    UNAUTHORIZED = "UNAUTHORIZED"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"

    # Authorization Errors (403)
    FORBIDDEN = "FORBIDDEN"
    INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS"
    RESOURCE_ACCESS_DENIED = "RESOURCE_ACCESS_DENIED"

    # Not Found Errors (404)
    NOT_FOUND = "NOT_FOUND"
    JOB_NOT_FOUND = "JOB_NOT_FOUND"
    PIPELINE_NOT_FOUND = "PIPELINE_NOT_FOUND"
    CREDENTIAL_NOT_FOUND = "CREDENTIAL_NOT_FOUND"
    USER_NOT_FOUND = "USER_NOT_FOUND"
    EXECUTION_NOT_FOUND = "EXECUTION_NOT_FOUND"
    DOCUMENT_NOT_FOUND = "DOCUMENT_NOT_FOUND"

    # Conflict Errors (409)
    CONFLICT = "CONFLICT"
    DUPLICATE_ENTRY = "DUPLICATE_ENTRY"
    RESOURCE_IN_USE = "RESOURCE_IN_USE"
    VERSION_CONFLICT = "VERSION_CONFLICT"

    # Unprocessable Entity (422)
    UNPROCESSABLE_ENTITY = "UNPROCESSABLE_ENTITY"
    SCHEMA_VALIDATION_FAILED = "SCHEMA_VALIDATION_FAILED"

    # External Service Errors (502/503)
    EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR"
    AI_PROVIDER_ERROR = "AI_PROVIDER_ERROR"
    DATABASE_ERROR = "DATABASE_ERROR"
    VECTOR_STORE_ERROR = "VECTOR_STORE_ERROR"

    # Execution Errors (500)
    INTERNAL_ERROR = "INTERNAL_ERROR"
    JOB_EXECUTION_FAILED = "JOB_EXECUTION_FAILED"
    PIPELINE_EXECUTION_FAILED = "PIPELINE_EXECUTION_FAILED"
    CONFIGURATION_ERROR = "CONFIGURATION_ERROR"

    # Rate Limiting (429)
    RATE_LIMITED = "RATE_LIMITED"
    QUOTA_EXCEEDED = "QUOTA_EXCEEDED"


class OddjobException(Exception):
    """Base exception class for Oddjob services."""

    def __init__(
        self,
        message: str,
        error_code: str = ErrorCode.INTERNAL_ERROR,
        status_code: int = 500,
        details: Optional[Dict[str, Any]] = None
    ):
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.status_code = status_code
        self.details = details or {}

    def to_dict(self) -> Dict[str, Any]:
        """Convert exception to dictionary for API responses."""
        return {
            "error": {
                "code": self.error_code,
                "message": self.message,
                "details": self.details
            }
        }


class ValidationError(OddjobException):
    """Validation error for input data."""

    def __init__(self, message: str, field: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message,
            error_code=ErrorCode.VALIDATION_FAILED,
            status_code=400,
            details={"field": field, **(details or {})}
        )


class ExternalServiceError(OddjobException):
    """Error from external service calls."""

    def __init__(self, message: str, service: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message,
            error_code=ErrorCode.EXTERNAL_SERVICE_ERROR,
            status_code=502,
            details={"service": service, **(details or {})}
        )


class ResourceNotFoundError(OddjobException):
    """Resource not found error."""

    def __init__(self, resource: str, identifier: Optional[str] = None):
        message = f"{resource} not found"
        if identifier:
            message += f": {identifier}"
        super().__init__(
            message,
            error_code=ErrorCode.NOT_FOUND,
            status_code=404,
            details={"resource": resource, "identifier": identifier}
        )


class ConfigurationError(OddjobException):
    """Configuration error."""

    def __init__(self, message: str, config_key: Optional[str] = None):
        super().__init__(
            message,
            error_code=ErrorCode.CONFIGURATION_ERROR,
            status_code=500,
            details={"config_key": config_key}
        )


class ProcessingError(OddjobException):
    """Error during data processing."""

    def __init__(self, message: str, operation: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message,
            error_code=ErrorCode.UNPROCESSABLE_ENTITY,
            status_code=422,
            details={"operation": operation, **(details or {})}
        )


class RateLimitError(OddjobException):
    """Rate limit exceeded."""

    def __init__(self, message: str = "Rate limit exceeded", retry_after: Optional[int] = None):
        super().__init__(
            message,
            error_code=ErrorCode.RATE_LIMITED,
            status_code=429,
            details={"retry_after": retry_after}
        )


class AuthenticationError(OddjobException):
    """Authentication error."""

    def __init__(self, message: str = "Authentication required"):
        super().__init__(
            message,
            error_code=ErrorCode.UNAUTHORIZED,
            status_code=401
        )


class AuthorizationError(OddjobException):
    """Authorization error."""

    def __init__(self, message: str = "Insufficient permissions"):
        super().__init__(
            message,
            error_code=ErrorCode.FORBIDDEN,
            status_code=403
        )