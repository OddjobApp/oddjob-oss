"""
API Response Utilities
Standardized response formatting and error handling for consistent API responses
"""

from typing import Any, Dict, List, Optional, Union
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import HTTPException
from fastapi.responses import JSONResponse


class APIResponse(BaseModel):
    """Standard API response wrapper."""
    success: bool
    data: Optional[Any] = None
    message: Optional[str] = None
    errors: Optional[List[Dict[str, Any]]] = None
    meta: Optional[Dict[str, Any]] = None
    timestamp: str

    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class PaginatedResponse(BaseModel):
    """Paginated API response."""
    success: bool
    data: List[Any]
    message: Optional[str] = None
    pagination: Dict[str, Any]
    meta: Optional[Dict[str, Any]] = None
    timestamp: str


class ErrorDetail(BaseModel):
    """Detailed error information."""
    code: str
    message: str
    field: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class APIResponseBuilder:
    """Builder for creating standardized API responses."""

    @staticmethod
    def success(
        data: Any = None,
        message: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None
    ) -> APIResponse:
        """Create a successful response."""
        return APIResponse(
            success=True,
            data=data,
            message=message,
            meta=meta,
            timestamp=datetime.now(timezone.utc).isoformat()
        )

    @staticmethod
    def error(
        message: str,
        errors: Optional[List[ErrorDetail]] = None,
        code: str = "INTERNAL_ERROR",
        meta: Optional[Dict[str, Any]] = None
    ) -> APIResponse:
        """Create an error response."""
        error_list = errors or [ErrorDetail(code=code, message=message)]
        return APIResponse(
            success=False,
            message=message,
            errors=[error.dict() for error in error_list],
            meta=meta,
            timestamp=datetime.now(timezone.utc).isoformat()
        )

    @staticmethod
    def paginated(
        data: List[Any],
        page: int,
        per_page: int,
        total: int,
        message: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None
    ) -> PaginatedResponse:
        """Create a paginated response."""
        total_pages = (total + per_page - 1) // per_page  # Ceiling division

        pagination = {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
            "next_page": page + 1 if page < total_pages else None,
            "prev_page": page - 1 if page > 1 else None
        }

        return PaginatedResponse(
            success=True,
            data=data,
            message=message,
            pagination=pagination,
            meta=meta,
            timestamp=datetime.now(timezone.utc).isoformat()
        )


class HTTPResponseFactory:
    """Factory for creating FastAPI HTTP responses with consistent formatting."""

    @staticmethod
    def success_response(
        data: Any = None,
        message: Optional[str] = None,
        status_code: int = 200,
        headers: Optional[Dict[str, str]] = None
    ) -> JSONResponse:
        """Create a successful JSON response."""
        response_data = APIResponseBuilder.success(data, message)
        return JSONResponse(
            content=response_data.dict(),
            status_code=status_code,
            headers=headers
        )

    @staticmethod
    def error_response(
        message: str,
        status_code: int = 400,
        errors: Optional[List[ErrorDetail]] = None,
        headers: Optional[Dict[str, str]] = None
    ) -> JSONResponse:
        """Create an error JSON response."""
        response_data = APIResponseBuilder.error(message, errors)
        return JSONResponse(
            content=response_data.dict(),
            status_code=status_code,
            headers=headers
        )

    @staticmethod
    def paginated_response(
        data: List[Any],
        page: int,
        per_page: int,
        total: int,
        status_code: int = 200,
        message: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None
    ) -> JSONResponse:
        """Create a paginated JSON response."""
        response_data = APIResponseBuilder.paginated(data, page, per_page, total, message)
        return JSONResponse(
            content=response_data.dict(),
            status_code=status_code,
            headers=headers
        )

    @staticmethod
    def validation_error_response(
        errors: List[Dict[str, str]],
        message: str = "Validation failed"
    ) -> JSONResponse:
        """Create a validation error response."""
        error_details = [
            ErrorDetail(
                code="VALIDATION_ERROR",
                message=error.get("message", "Invalid value"),
                field=error.get("field"),
                details=error
            )
            for error in errors
        ]
        return HTTPResponseFactory.error_response(message, 422, error_details)

    @staticmethod
    def not_found_response(
        resource: str = "Resource",
        identifier: Optional[str] = None
    ) -> JSONResponse:
        """Create a not found error response."""
        message = f"{resource} not found"
        if identifier:
            message += f": {identifier}"

        error_detail = ErrorDetail(
            code="NOT_FOUND",
            message=message,
            details={"resource": resource, "identifier": identifier}
        )
        return HTTPResponseFactory.error_response(message, 404, [error_detail])

    @staticmethod
    def unauthorized_response(message: str = "Authentication required") -> JSONResponse:
        """Create an unauthorized error response."""
        error_detail = ErrorDetail(
            code="UNAUTHORIZED",
            message=message
        )
        return HTTPResponseFactory.error_response(message, 401, [error_detail])

    @staticmethod
    def forbidden_response(message: str = "Insufficient permissions") -> JSONResponse:
        """Create a forbidden error response."""
        error_detail = ErrorDetail(
            code="FORBIDDEN",
            message=message
        )
        return HTTPResponseFactory.error_response(message, 403, [error_detail])


# Convenience functions for common responses
def success_response(data: Any = None, message: Optional[str] = None) -> JSONResponse:
    """Create a successful response."""
    return HTTPResponseFactory.success_response(data, message)


def error_response(message: str, status_code: int = 400) -> JSONResponse:
    """Create an error response."""
    return HTTPResponseFactory.error_response(message, status_code)


def paginated_response(
    data: List[Any],
    page: int,
    per_page: int,
    total: int,
    message: Optional[str] = None
) -> JSONResponse:
    """Create a paginated response."""
    return HTTPResponseFactory.paginated_response(data, page, per_page, total, message=message)


def validation_error_response(errors: List[Dict[str, str]]) -> JSONResponse:
    """Create a validation error response."""
    return HTTPResponseFactory.validation_error_response(errors)


def not_found_response(resource: str = "Resource", identifier: Optional[str] = None) -> JSONResponse:
    """Create a not found response."""
    return HTTPResponseFactory.not_found_response(resource, identifier)


# Exception handlers for consistent error responses
def create_http_exception_handler():
    """Create a handler for HTTPException to standardized response."""
    def handler(request, exc: HTTPException):
        return HTTPResponseFactory.error_response(
            message=exc.detail,
            status_code=exc.status_code
        )
    return handler


def create_validation_exception_handler():
    """Create a handler for validation exceptions."""
    def handler(request, exc):
        errors = []
        if hasattr(exc, 'errors') and exc.errors:
            for error in exc.errors():
                errors.append({
                    "field": ".".join(str(loc) for loc in error["loc"]),
                    "message": error["msg"],
                    "type": error["type"]
                })
        else:
            errors.append({"message": str(exc)})

        return HTTPResponseFactory.validation_error_response(errors)
    return handler