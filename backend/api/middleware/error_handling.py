"""
Error Handling Middleware
Converts exceptions to proper HTTP responses
"""

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from core.exceptions import OddjobException
from core.logging import get_logger

logger = get_logger(__name__)


class ErrorHandlingMiddleware(BaseHTTPMiddleware):
    """Middleware to handle and format errors consistently."""

    async def dispatch(self, request: Request, call_next):
        try:
            response = await call_next(request)
            return response

        except OddjobException as e:
            # Handle custom application exceptions
            logger.warning(
                f"Application error: {e.error_code} - {e.message}",
                extra={
                    "request_id": getattr(request.state, "request_id", None),
                    "error_code": e.error_code,
                    "status_code": e.status_code,
                    "details": e.details
                }
            )

            return JSONResponse(
                status_code=e.status_code,
                content=e.to_dict()
            )

        except HTTPException as e:
            # Handle FastAPI HTTP exceptions
            logger.warning(
                f"HTTP exception: {e.status_code} - {e.detail}",
                extra={
                    "request_id": getattr(request.state, "request_id", None),
                    "status_code": e.status_code,
                    "detail": e.detail
                }
            )

            return JSONResponse(
                status_code=e.status_code,
                content={
                    "error": {
                        "code": f"HTTP_{e.status_code}",
                        "message": e.detail,
                        "details": {}
                    }
                }
            )

        except Exception as e:
            # Handle unexpected errors
            logger.error(
                f"Unexpected error: {type(e).__name__} - {str(e)}",
                exc_info=True,
                extra={
                    "request_id": getattr(request.state, "request_id", None),
                    "error_type": type(e).__name__
                }
            )

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