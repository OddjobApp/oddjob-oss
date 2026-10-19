"""
Structured Logging with Correlation IDs and Observability
Enhanced logging system with request tracing and performance monitoring
"""

import time
import uuid
import json
import logging
from typing import Dict, Any, Optional, List
from contextvars import ContextVar
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

from .config import settings

# Context variables for request-scoped data
request_id_var: ContextVar[Optional[str]] = ContextVar('request_id', default=None)
user_id_var: ContextVar[Optional[str]] = ContextVar('user_id', default=None)
correlation_id_var: ContextVar[Optional[str]] = ContextVar('correlation_id', default=None)
session_id_var: ContextVar[Optional[str]] = ContextVar('session_id', default=None)
endpoint_var: ContextVar[Optional[str]] = ContextVar('endpoint', default=None)
method_var: ContextVar[Optional[str]] = ContextVar('method', default=None)


@dataclass
class LogContext:
    """Structured log context information."""
    request_id: Optional[str] = None
    user_id: Optional[str] = None
    correlation_id: Optional[str] = None
    session_id: Optional[str] = None
    endpoint: Optional[str] = None
    method: Optional[str] = None
    status_code: Optional[int] = None
    duration_ms: Optional[float] = None
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    performance_metrics: Optional[Dict[str, Any]] = None
    custom_fields: Optional[Dict[str, Any]] = None


class StructuredLogger:
    """Enhanced logger with structured logging and correlation IDs."""

    def __init__(self, name: str):
        self.logger = logging.getLogger(name)
        self.name = name

    def _get_context(self) -> LogContext:
        """Get current request context."""
        return LogContext(
            request_id=request_id_var.get(),
            user_id=user_id_var.get(),
            correlation_id=correlation_id_var.get(),
            session_id=session_id_var.get(),
            endpoint=endpoint_var.get(),
            method=method_var.get()
        )

    def _format_message(self, message: str, context: LogContext, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Format log message with structured data."""
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": self.logger.level,
            "logger": self.name,
            "message": message,
            "service": "oddjob-backend",
            "version": settings.VERSION,
            "environment": "production" if not settings.DEBUG else "development"
        }

        # Add context fields
        context_dict = asdict(context)
        for key, value in context_dict.items():
            if value is not None:
                log_entry[key] = value

        # Add extra fields
        if extra:
            log_entry["extra"] = extra

        return log_entry

    def debug(self, message: str, extra: Optional[Dict[str, Any]] = None, **kwargs):
        """Log debug message."""
        if self.logger.isEnabledFor(logging.DEBUG):
            context = self._get_context()
            context.custom_fields = extra
            formatted = self._format_message(message, context, extra)
            self.logger.debug(json.dumps(formatted), extra={"structured": True})

    def info(self, message: str, extra: Optional[Dict[str, Any]] = None, **kwargs):
        """Log info message."""
        if self.logger.isEnabledFor(logging.INFO):
            context = self._get_context()
            context.custom_fields = extra
            formatted = self._format_message(message, context, extra)
            self.logger.info(json.dumps(formatted), extra={"structured": True})

    def warning(self, message: str, extra: Optional[Dict[str, Any]] = None, **kwargs):
        """Log warning message."""
        if self.logger.isEnabledFor(logging.WARNING):
            context = self._get_context()
            context.custom_fields = extra
            formatted = self._format_message(message, context, extra)
            self.logger.warning(json.dumps(formatted), extra={"structured": True})

    def error(self, message: str, exc_info: Optional[Any] = None, extra: Optional[Dict[str, Any]] = None, **kwargs):
        """Log error message."""
        if self.logger.isEnabledFor(logging.ERROR):
            context = self._get_context()
            context.custom_fields = extra
            context.error_message = message
            formatted = self._format_message(message, context, extra)

            # Add exception info if provided
            if exc_info:
                formatted["exception"] = str(exc_info)

            self.logger.error(json.dumps(formatted), exc_info=exc_info, extra={"structured": True})

    def critical(self, message: str, exc_info: Optional[Any] = None, extra: Optional[Dict[str, Any]] = None, **kwargs):
        """Log critical message."""
        if self.logger.isEnabledFor(logging.CRITICAL):
            context = self._get_context()
            context.custom_fields = extra
            context.error_message = message
            formatted = self._format_message(message, context, extra)

            if exc_info:
                formatted["exception"] = str(exc_info)

            self.logger.critical(json.dumps(formatted), exc_info=exc_info, extra={"structured": True})


class RequestTracer:
    """Request tracing and correlation ID management."""

    @staticmethod
    def generate_request_id() -> str:
        """Generate a unique request ID."""
        return f"req_{uuid.uuid4().hex[:16]}"

    @staticmethod
    def generate_correlation_id() -> str:
        """Generate a correlation ID for distributed tracing."""
        return f"corr_{uuid.uuid4().hex[:16]}"

    @staticmethod
    def set_request_context(
        request_id: Optional[str] = None,
        user_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        session_id: Optional[str] = None,
        endpoint: Optional[str] = None,
        method: Optional[str] = None,
        **kwargs
    ):
        """Set request context variables."""
        if request_id:
            request_id_var.set(request_id)
        if user_id:
            user_id_var.set(user_id)
        if correlation_id:
            correlation_id_var.set(correlation_id)
        if session_id:
            session_id_var.set(session_id)
        if endpoint:
            endpoint_var.set(endpoint)
        if method:
            method_var.set(method)

    @staticmethod
    def get_request_context() -> Dict[str, Optional[str]]:
        """Get current request context."""
        return {
            "request_id": request_id_var.get(),
            "user_id": user_id_var.get(),
            "correlation_id": correlation_id_var.get(),
            "session_id": session_id_var.get(),
            "endpoint": endpoint_var.get(),
            "method": method_var.get()
        }

    @staticmethod
    def clear_request_context():
        """Clear request context (for cleanup)."""
        request_id_var.set(None)
        user_id_var.set(None)
        correlation_id_var.set(None)
        session_id_var.set(None)
        endpoint_var.set(None)
        method_var.set(None)


class PerformanceMonitor:
    """Performance monitoring and metrics collection."""

    def __init__(self):
        self.logger = StructuredLogger("performance")

    def start_operation(self, operation_name: str) -> str:
        """Start timing an operation and return operation ID."""
        operation_id = f"op_{uuid.uuid4().hex[:8]}"
        self.logger.info(
            f"Started operation: {operation_name}",
            extra={
                "operation_id": operation_id,
                "operation_name": operation_name,
                "event": "operation_started"
            }
        )
        return operation_id

    def end_operation(self, operation_id: str, operation_name: str, success: bool = True, metadata: Optional[Dict[str, Any]] = None):
        """End timing an operation."""
        self.logger.info(
            f"Completed operation: {operation_name}",
            extra={
                "operation_id": operation_id,
                "operation_name": operation_name,
                "success": success,
                "event": "operation_completed",
                "metadata": metadata or {}
            }
        )

    def record_metric(self, name: str, value: float, tags: Optional[Dict[str, str]] = None):
        """Record a performance metric."""
        self.logger.info(
            f"Metric recorded: {name} = {value}",
            extra={
                "metric_name": name,
                "metric_value": value,
                "metric_tags": tags or {},
                "event": "metric_recorded"
            }
        )

    def record_api_call(self, endpoint: str, method: str, status_code: int, duration_ms: float, user_id: Optional[str] = None):
        """Record API call metrics."""
        self.logger.info(
            f"API call: {method} {endpoint}",
            extra={
                "endpoint": endpoint,
                "method": method,
                "status_code": status_code,
                "duration_ms": duration_ms,
                "user_id": user_id,
                "event": "api_call"
            }
        )


class LogAggregator:
    """Log aggregation and analysis utilities."""

    @staticmethod
    def summarize_logs(logs: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Summarize log entries for analysis."""
        summary = {
            "total_logs": len(logs),
            "error_count": 0,
            "warning_count": 0,
            "info_count": 0,
            "debug_count": 0,
            "unique_users": set(),
            "unique_endpoints": set(),
            "status_codes": {},
            "errors_by_type": {},
            "performance_metrics": {
                "avg_response_time": 0,
                "max_response_time": 0,
                "min_response_time": float('inf'),
                "total_requests": 0
            }
        }

        total_duration = 0
        request_count = 0

        for log in logs:
            # Count by level
            level = log.get("level", "").lower()
            if "error" in level:
                summary["error_count"] += 1
            elif "warn" in level:
                summary["warning_count"] += 1
            elif "info" in level:
                summary["info_count"] += 1
            elif "debug" in level:
                summary["debug_count"] += 1

            # Collect unique users and endpoints
            if log.get("user_id"):
                summary["unique_users"].add(log["user_id"])
            if log.get("endpoint"):
                summary["unique_endpoints"].add(log["endpoint"])

            # Status codes
            status_code = log.get("status_code")
            if status_code:
                summary["status_codes"][status_code] = summary["status_codes"].get(status_code, 0) + 1

            # Errors by type
            if log.get("error_code"):
                error_type = log["error_code"]
                summary["errors_by_type"][error_type] = summary["errors_by_type"].get(error_type, 0) + 1

            # Performance metrics
            duration = log.get("duration_ms")
            if duration:
                total_duration += duration
                request_count += 1
                summary["performance_metrics"]["max_response_time"] = max(
                    summary["performance_metrics"]["max_response_time"], duration
                )
                summary["performance_metrics"]["min_response_time"] = min(
                    summary["performance_metrics"]["min_response_time"], duration
                )

        # Calculate averages
        if request_count > 0:
            summary["performance_metrics"]["avg_response_time"] = total_duration / request_count
        summary["performance_metrics"]["total_requests"] = request_count

        # Convert sets to counts
        summary["unique_users"] = len(summary["unique_users"])
        summary["unique_endpoints"] = len(summary["unique_endpoints"])

        return summary


# Global instances
tracer = RequestTracer()
performance_monitor = PerformanceMonitor()
log_aggregator = LogAggregator()

# Convenience function to get a structured logger
def get_structured_logger(name: str) -> StructuredLogger:
    """Get a structured logger instance."""
    return StructuredLogger(name)