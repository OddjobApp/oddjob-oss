"""
Performance Metrics and Application Performance Monitoring (APM)
Comprehensive performance tracking and monitoring system
"""

import time
import asyncio
import psutil
from typing import Dict, Any, List, Optional, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from functools import wraps

from core.structured_logging import get_structured_logger, performance_monitor

logger = get_structured_logger("apm")


@dataclass
class PerformanceMetrics:
    """Container for performance metrics."""
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Response time metrics
    response_time_ms: Optional[float] = None
    request_count: int = 0
    error_count: int = 0

    # System metrics
    cpu_percent: Optional[float] = None
    memory_percent: Optional[float] = None
    disk_usage_percent: Optional[float] = None

    # Database metrics
    db_connection_count: Optional[int] = None
    db_query_count: Optional[int] = 0
    db_query_time_ms: Optional[float] = None

    # Cache metrics
    cache_hit_count: Optional[int] = 0
    cache_miss_count: Optional[int] = 0
    cache_hit_rate: Optional[float] = None

    # Business metrics
    active_users: Optional[int] = None
    concurrent_requests: Optional[int] = 0

    # Custom metrics
    custom_metrics: Dict[str, Any] = field(default_factory=dict)


class MetricsCollector:
    """Collects and aggregates performance metrics."""

    def __init__(self):
        self.metrics_history: List[PerformanceMetrics] = []
        self.max_history_size = 1000
        self.collection_interval = 60  # seconds

    async def collect_system_metrics(self) -> Dict[str, Any]:
        """Collect system-level performance metrics."""
        try:
            return {
                "cpu_percent": psutil.cpu_percent(interval=1),
                "memory_percent": psutil.virtual_memory().percent,
                "disk_usage_percent": psutil.disk_usage('/').percent,
                "load_average": psutil.getloadavg() if hasattr(psutil, 'getloadavg') else None,
                "network_connections": len(psutil.net_connections()),
                "process_count": len(psutil.pids())
            }
        except Exception as e:
            logger.error(f"Failed to collect system metrics: {str(e)}")
            return {}

    async def collect_application_metrics(self) -> Dict[str, Any]:
        """Collect application-specific metrics."""
        # This would integrate with your application state
        # For now, return placeholder metrics
        return {
            "active_connections": 0,  # Would come from connection pool
            "queued_requests": 0,     # Would come from request queue
            "active_sessions": 0,     # Would come from session store
        }

    def calculate_percentiles(self, values: List[float], percentiles: List[float]) -> Dict[str, float]:
        """Calculate percentiles from a list of values."""
        if not values:
            return {}

        sorted_values = sorted(values)
        result = {}

        for p in percentiles:
            if p == 100:
                result[f"p{p}"] = sorted_values[-1]
            else:
                index = int((p / 100) * (len(sorted_values) - 1))
                result[f"p{p}"] = sorted_values[index]

        return result

    def get_metrics_summary(self, time_window_seconds: int = 300) -> Dict[str, Any]:
        """Get summary of metrics over a time window."""
        cutoff_time = datetime.now(timezone.utc).timestamp() - time_window_seconds

        recent_metrics = [
            m for m in self.metrics_history
            if m.timestamp.timestamp() > cutoff_time
        ]

        if not recent_metrics:
            return {"error": "No metrics available for the specified time window"}

        # Aggregate metrics
        response_times = [m.response_time_ms for m in recent_metrics if m.response_time_ms is not None]

        summary = {
            "time_window_seconds": time_window_seconds,
            "total_requests": sum(m.request_count for m in recent_metrics),
            "total_errors": sum(m.error_count for m in recent_metrics),
            "avg_response_time_ms": sum(response_times) / len(response_times) if response_times else None,
            "response_time_percentiles": self.calculate_percentiles(response_times, [50, 95, 99]),
            "system_metrics": {
                "avg_cpu_percent": sum(m.cpu_percent for m in recent_metrics if m.cpu_percent) / len(recent_metrics),
                "avg_memory_percent": sum(m.memory_percent for m in recent_metrics if m.memory_percent) / len(recent_metrics),
                "avg_disk_usage_percent": sum(m.disk_usage_percent for m in recent_metrics if m.disk_usage_percent) / len(recent_metrics),
            }
        }

        return summary


class APMMiddleware:
    """Application Performance Monitoring middleware."""

    def __init__(self, app):
        self.app = app
        self.metrics_collector = MetricsCollector()
        self.request_counts: Dict[str, int] = {}
        self.error_counts: Dict[str, int] = {}

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Extract request information
        method = scope.get("method", "UNKNOWN")
        path = scope.get("path", "UNKNOWN")
        endpoint = f"{method} {path}"

        # Start timing
        start_time = time.time()

        # Track concurrent requests
        self.request_counts[endpoint] = self.request_counts.get(endpoint, 0) + 1

        # Create metrics for this request
        request_metrics = PerformanceMetrics()
        request_metrics.request_count = 1
        request_metrics.concurrent_requests = self.request_counts[endpoint]

        try:
            await self.app(scope, receive, send)

            # Calculate response time
            response_time = (time.time() - start_time) * 1000  # Convert to milliseconds
            request_metrics.response_time_ms = response_time

            # Log successful request
            logger.info(
                f"Request completed: {endpoint}",
                extra={
                    "endpoint": endpoint,
                    "response_time_ms": response_time,
                    "status": "success",
                    "event": "request_completed"
                }
            )

        except Exception as e:
            # Track error
            request_metrics.error_count = 1
            response_time = (time.time() - start_time) * 1000
            request_metrics.response_time_ms = response_time

            # Update error counts
            self.error_counts[endpoint] = self.error_counts.get(endpoint, 0) + 1

            # Log error
            logger.error(
                f"Request failed: {endpoint}",
                extra={
                    "endpoint": endpoint,
                    "response_time_ms": response_time,
                    "error": str(e),
                    "status": "error",
                    "event": "request_failed"
                }
            )

            raise

        finally:
            # Decrement concurrent request count
            self.request_counts[endpoint] = max(0, self.request_counts[endpoint] - 1)

            # Collect system metrics periodically
            if len(self.metrics_collector.metrics_history) % 10 == 0:  # Every 10 requests
                asyncio.create_task(self._collect_system_metrics())

            # Store metrics
            self.metrics_collector.metrics_history.append(request_metrics)

            # Limit history size
            if len(self.metrics_collector.metrics_history) > self.metrics_collector.max_history_size:
                self.metrics_collector.metrics_history = self.metrics_collector.metrics_history[-self.metrics_collector.max_history_size:]

    async def _collect_system_metrics(self):
        """Collect system metrics in background."""
        try:
            system_metrics = await self.metrics_collector.collect_system_metrics()

            # Update latest metrics
            if self.metrics_collector.metrics_history:
                latest = self.metrics_collector.metrics_history[-1]
                latest.cpu_percent = system_metrics.get("cpu_percent")
                latest.memory_percent = system_metrics.get("memory_percent")
                latest.disk_usage_percent = system_metrics.get("disk_usage_percent")

        except Exception as e:
            logger.error(f"Failed to collect system metrics: {str(e)}")


# Performance monitoring decorators
def monitor_performance(operation_name: str):
    """Decorator to monitor function performance."""
    def decorator(func: Callable) -> Callable:
        if asyncio.iscoroutinefunction(func):
            @wraps(func)
            async def async_wrapper(*args, **kwargs):
                operation_id = performance_monitor.start_operation(operation_name)
                start_time = time.time()

                try:
                    result = await func(*args, **kwargs)
                    duration = (time.time() - start_time) * 1000

                    performance_monitor.end_operation(
                        operation_id,
                        operation_name,
                        success=True,
                        metadata={"duration_ms": duration}
                    )

                    performance_monitor.record_metric(
                        f"operation.{operation_name}.duration",
                        duration,
                        {"operation": operation_name}
                    )

                    return result

                except Exception as e:
                    duration = (time.time() - start_time) * 1000

                    performance_monitor.end_operation(
                        operation_id,
                        operation_name,
                        success=False,
                        metadata={"duration_ms": duration, "error": str(e)}
                    )

                    raise

            return async_wrapper
        else:
            @wraps(func)
            def sync_wrapper(*args, **kwargs):
                operation_id = performance_monitor.start_operation(operation_name)
                start_time = time.time()

                try:
                    result = func(*args, **kwargs)
                    duration = (time.time() - start_time) * 1000

                    performance_monitor.end_operation(
                        operation_id,
                        operation_name,
                        success=True,
                        metadata={"duration_ms": duration}
                    )

                    return result

                except Exception as e:
                    duration = (time.time() - start_time) * 1000

                    performance_monitor.end_operation(
                        operation_id,
                        operation_name,
                        success=False,
                        metadata={"duration_ms": duration, "error": str(e)}
                    )

                    raise

            return sync_wrapper

    return decorator


def monitor_api_endpoint():
    """Decorator specifically for API endpoints."""
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Extract endpoint information from function
            endpoint_name = f"{func.__module__}.{func.__name__}"

            operation_id = performance_monitor.start_operation(f"api_{endpoint_name}")
            start_time = time.time()

            try:
                result = await func(*args, **kwargs)
                duration = (time.time() - start_time) * 1000

                performance_monitor.end_operation(
                    operation_id,
                    f"api_{endpoint_name}",
                    success=True,
                    metadata={"duration_ms": duration}
                )

                # Record API-specific metrics
                performance_monitor.record_metric(
                    "api.response_time",
                    duration,
                    {"endpoint": endpoint_name, "status": "success"}
                )

                return result

            except Exception as e:
                duration = (time.time() - start_time) * 1000

                performance_monitor.end_operation(
                    operation_id,
                    f"api_{endpoint_name}",
                    success=False,
                    metadata={"duration_ms": duration, "error": str(e)}
                )

                performance_monitor.record_metric(
                    "api.error_count",
                    1,
                    {"endpoint": endpoint_name, "error_type": type(e).__name__}
                )

                raise

        return wrapper

    return decorator


# Global metrics collector instance
metrics_collector = MetricsCollector()


@asynccontextmanager
async def performance_context(operation_name: str):
    """Async context manager for performance monitoring."""
    operation_id = performance_monitor.start_operation(operation_name)
    start_time = time.time()

    try:
        yield
        duration = (time.time() - start_time) * 1000

        performance_monitor.end_operation(
            operation_id,
            operation_name,
            success=True,
            metadata={"duration_ms": duration}
        )

    except Exception as e:
        duration = (time.time() - start_time) * 1000

        performance_monitor.end_operation(
            operation_id,
            operation_name,
            success=False,
            metadata={"duration_ms": duration, "error": str(e)}
        )

        raise