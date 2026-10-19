"""
Health Check Utilities
Shared utilities for health checking and status determination
"""

from __future__ import annotations
from typing import Dict, Any, List


def determine_overall_status(services: Dict[str, Any]) -> str:
    """
    Determine overall system status based on individual service statuses.

    Args:
        services: Dictionary of service names to ServiceHealth objects

    Returns:
        Overall status string: "healthy", "degraded", or "unhealthy"
    """
    if not services:
        return "unknown"

    service_statuses = [service.status for service in services.values()]

    if any(status == "unhealthy" for status in service_statuses):
        return "unhealthy"
    elif any(status == "degraded" for status in service_statuses):
        return "degraded"
    elif all(status == "healthy" for status in service_statuses):
        return "healthy"
    else:
        return "unknown"


def aggregate_service_metrics(services: Dict[str, Any]) -> Dict[str, Any]:
    """
    Aggregate metrics from all services for reporting.

    Args:
        services: Dictionary of service names to ServiceHealth objects

    Returns:
        Aggregated metrics dictionary
    """
    total_services = len(services)
    healthy_count = sum(1 for s in services.values() if s.status == "healthy")
    degraded_count = sum(1 for s in services.values() if s.status == "degraded")
    unhealthy_count = sum(1 for s in services.values() if s.status == "unhealthy")

    # Calculate average response time
    response_times = [s.response_time_ms for s in services.values() if s.response_time_ms is not None]
    avg_response_time = sum(response_times) / len(response_times) if response_times else None

    return {
        "total_services": total_services,
        "healthy_services": healthy_count,
        "degraded_services": degraded_count,
        "unhealthy_services": unhealthy_count,
        "average_response_time_ms": avg_response_time,
        "uptime_percentage": (healthy_count / total_services * 100) if total_services > 0 else 0
    }


def format_service_status_summary(services: Dict[str, Any]) -> Dict[str, Any]:
    """
    Format services status for API responses.

    Args:
        services: Dictionary of service names to ServiceHealth objects

    Returns:
        Formatted summary dictionary
    """
    return {
        "overall_status": determine_overall_status(services),
        "service_count": len(services),
        "services": {
            name: {
                "status": service.status,
                "response_time_ms": service.response_time_ms,
                "last_checked": service.last_checked,
                "has_details": service.details is not None
            }
            for name, service in services.items()
        },
        "metrics": aggregate_service_metrics(services)
    }