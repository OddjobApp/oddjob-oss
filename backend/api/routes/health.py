"""
Health Check Routes
API endpoints for health monitoring and status checks
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Dict, Any, Optional
import asyncio
import psutil
import time
from datetime import datetime, timezone

from core.config import settings
from core.caching import cache_manager
from core.structured_logging import log_aggregator
from core.performance_monitoring import metrics_collector
from core.auth_middleware import get_current_user, AuthenticatedUser
from core.health_utils import determine_overall_status, aggregate_service_metrics
import asyncio

router = APIRouter()

# Global variable to track application start time
_app_start_time: Optional[float] = None


class ServiceHealth(BaseModel):
    """Individual service health information."""
    status: str  # "healthy", "unhealthy", "degraded", "unknown"
    response_time_ms: Optional[float] = None
    last_checked: str
    details: Optional[Dict[str, Any]] = None


class HealthResponse(BaseModel):
    """Basic health check response."""
    status: str
    timestamp: str
    version: str
    uptime: float


class DetailedHealthResponse(BaseModel):
    """Detailed health check with comprehensive monitoring data."""
    status: str
    timestamp: str
    version: str
    uptime: float
    services: Dict[str, ServiceHealth]
    system: Dict[str, Any]
    performance: Dict[str, Any]
    cache: Optional[Dict[str, Any]] = None


class MetricsResponse(BaseModel):
    """Performance metrics response."""
    summary: Dict[str, Any]
    time_window_seconds: int
    collected_at: str


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Basic health check endpoint.

    Returns the current status of the service and basic system information.
    """
    # Use a global variable to track start time instead of router attribute
    global _app_start_time
    if _app_start_time is None:
        _app_start_time = time.time()

    uptime = time.time() - _app_start_time

    # Check basic services
    services = await check_services_health()

    # Determine overall status using utility function
    overall_status = determine_overall_status(services)

    return HealthResponse(
        status=overall_status,
        timestamp=datetime.now(timezone.utc).isoformat(),
        version=settings.VERSION,
        uptime=uptime
    )


async def check_cache_health() -> ServiceHealth:
    """Check Redis cache health."""
    timestamp = datetime.now(timezone.utc).isoformat()

    try:
        start_time = time.time()
        cache_health = await cache_manager.health_check()
        response_time = (time.time() - start_time) * 1000

        return ServiceHealth(
            status="healthy" if cache_health.get("status") in ["healthy", "disabled"] else "unhealthy",
            response_time_ms=response_time,
            last_checked=timestamp,
            details=cache_health
        )
    except Exception as e:
        return ServiceHealth(
            status="unhealthy",
            last_checked=timestamp,
            details={"error": str(e)}
        )


async def check_database_health() -> ServiceHealth:
    """Check database connectivity and health."""
    timestamp = datetime.now(timezone.utc).isoformat()

    try:
        # In real implementation, check actual database connection
        # For now, return healthy status with mock data
        return ServiceHealth(
            status="healthy",
            response_time_ms=5.0,
            last_checked=timestamp,
            details={"connection_pool_size": 10, "active_connections": 2}
        )
    except Exception as e:
        return ServiceHealth(
            status="unhealthy",
            last_checked=timestamp,
            details={"error": str(e)}
        )


async def check_external_apis_health() -> ServiceHealth:
    """Check external API connectivity."""
    timestamp = datetime.now(timezone.utc).isoformat()

    try:
        # In real implementation, ping external APIs
        # For now, return healthy status with mock data
        return ServiceHealth(
            status="healthy",
            response_time_ms=50.0,
            last_checked=timestamp,
            details={"apis_checked": ["openai", "anthropic"], "all_healthy": True}
        )
    except Exception as e:
        return ServiceHealth(
            status="unhealthy",
            last_checked=timestamp,
            details={"error": str(e)}
        )


async def check_ml_models_health() -> ServiceHealth:
    """Check ML model loading and health status."""
    timestamp = datetime.now(timezone.utc).isoformat()

    try:
        # In real implementation, check model loading status
        # For now, return healthy status with mock data
        return ServiceHealth(
            status="healthy",
            last_checked=timestamp,
            details={"models_loaded": ["embedder"], "memory_usage": "256MB"}
        )
    except Exception as e:
        return ServiceHealth(
            status="unhealthy",
            last_checked=timestamp,
            details={"error": str(e)}
        )


async def check_services_health() -> Dict[str, ServiceHealth]:
    """Check health of all external services and dependencies."""
    services = {}

    # Run all health checks concurrently for better performance
    health_checks = await asyncio.gather(
        check_cache_health(),
        check_database_health(),
        check_external_apis_health(),
        check_ml_models_health(),
        return_exceptions=True
    )

    service_names = ["redis_cache", "database", "external_apis", "ml_models"]

    for name, health_result in zip(service_names, health_checks):
        if isinstance(health_result, Exception):
            # If health check failed with exception, mark as unhealthy
            services[name] = ServiceHealth(
                status="unhealthy",
                last_checked=datetime.now(timezone.utc).isoformat(),
                details={"error": str(health_result)}
            )
        else:
            services[name] = health_result

    return services


@router.get("/health/detailed", response_model=DetailedHealthResponse)
async def detailed_health_check() -> DetailedHealthResponse:
    """
    Comprehensive health check with system, performance, and service monitoring.

    Returns detailed health information including system metrics, performance data,
    and status of all services and dependencies.
    """
    # Use a global variable to track start time instead of router attribute
    global _app_start_time
    if _app_start_time is None:
        _app_start_time = time.time()

    uptime = time.time() - _app_start_time
    timestamp = datetime.now(timezone.utc).isoformat()

    # Get service health
    services = await check_services_health()

    # Determine overall status using utility function
    overall_status = determine_overall_status(services)

    # Collect system metrics
    system_info = {
        "cpu_percent": psutil.cpu_percent(interval=1),
        "memory_percent": psutil.virtual_memory().percent,
        "memory_used_gb": psutil.virtual_memory().used / (1024**3),
        "memory_total_gb": psutil.virtual_memory().total / (1024**3),
        "disk_usage": {
            "total_gb": psutil.disk_usage('/').total / (1024**3),
            "used_gb": psutil.disk_usage('/').used / (1024**3),
            "free_gb": psutil.disk_usage('/').free / (1024**3),
            "percent": psutil.disk_usage('/').percent
        },
        "load_average": psutil.getloadavg() if hasattr(psutil, 'getloadavg') else None,
        "process_count": len(psutil.pids()),
        "network_connections": len(psutil.net_connections())
    }

    # Get performance metrics summary (last 5 minutes)
    performance_summary = metrics_collector.get_metrics_summary(300)

    # Get cache health
    cache_health = None
    try:
        cache_health = await cache_manager.health_check()
    except Exception as e:
        cache_health = {"status": "error", "error": str(e)}

    return DetailedHealthResponse(
        status=overall_status,
        timestamp=timestamp,
        version=settings.VERSION,
        uptime=uptime,
        services=services,
        system=system_info,
        performance=performance_summary,
        cache=cache_health
    )


@router.get("/ping")
async def ping():
    """
    Simple ping endpoint for load balancer health checks.

    Returns a simple pong response.
    """
    return {"message": "pong"}