"""
Tests for Health Check Utilities
"""

import pytest
from unittest.mock import MagicMock
from core.health_utils import determine_overall_status, aggregate_service_metrics, format_service_status_summary


class TestDetermineOverallStatus:
    """Test determine_overall_status function."""

    def test_empty_services_returns_unknown(self):
        """Test that empty services dict returns unknown status."""
        result = determine_overall_status({})
        assert result == "unknown"

    def test_all_healthy_returns_healthy(self):
        """Test that all healthy services return healthy status."""
        services = {
            "redis": MagicMock(status="healthy"),
            "database": MagicMock(status="healthy"),
            "api": MagicMock(status="healthy")
        }
        result = determine_overall_status(services)
        assert result == "healthy"

    def test_any_unhealthy_returns_unhealthy(self):
        """Test that any unhealthy service returns unhealthy status."""
        services = {
            "redis": MagicMock(status="healthy"),
            "database": MagicMock(status="unhealthy"),
            "api": MagicMock(status="healthy")
        }
        result = determine_overall_status(services)
        assert result == "unhealthy"

    def test_degraded_without_unhealthy_returns_degraded(self):
        """Test that degraded services return degraded status when no unhealthy services."""
        services = {
            "redis": MagicMock(status="healthy"),
            "database": MagicMock(status="degraded"),
            "api": MagicMock(status="healthy")
        }
        result = determine_overall_status(services)
        assert result == "degraded"

    def test_unhealthy_takes_precedence_over_degraded(self):
        """Test that unhealthy status takes precedence over degraded."""
        services = {
            "redis": MagicMock(status="degraded"),
            "database": MagicMock(status="unhealthy"),
            "api": MagicMock(status="healthy")
        }
        result = determine_overall_status(services)
        assert result == "unhealthy"


class TestAggregateServiceMetrics:
    """Test aggregate_service_metrics function."""

    def test_aggregate_empty_services(self):
        """Test aggregating metrics for empty services."""
        result = aggregate_service_metrics({})
        expected = {
            "total_services": 0,
            "healthy_services": 0,
            "degraded_services": 0,
            "unhealthy_services": 0,
            "average_response_time_ms": None,
            "uptime_percentage": 0
        }
        assert result == expected

    def test_aggregate_mixed_services(self):
        """Test aggregating metrics for mixed service statuses."""
        services = {
            "redis": MagicMock(status="healthy", response_time_ms=10.0),
            "database": MagicMock(status="degraded", response_time_ms=50.0),
            "api": MagicMock(status="unhealthy", response_time_ms=200.0),
            "cache": MagicMock(status="healthy", response_time_ms=5.0)
        }
        result = aggregate_service_metrics(services)

        assert result["total_services"] == 4
        assert result["healthy_services"] == 2
        assert result["degraded_services"] == 1
        assert result["unhealthy_services"] == 1
        assert result["average_response_time_ms"] == 66.25  # (10+50+200+5)/4
        assert result["uptime_percentage"] == 50.0  # 2/4 * 100

    def test_aggregate_no_response_times(self):
        """Test aggregating metrics when no services have response times."""
        services = {
            "redis": MagicMock(status="healthy", response_time_ms=None),
            "database": MagicMock(status="healthy", response_time_ms=None)
        }
        result = aggregate_service_metrics(services)

        assert result["average_response_time_ms"] is None


class TestFormatServiceStatusSummary:
    """Test format_service_status_summary function."""

    def test_format_summary_empty_services(self):
        """Test formatting summary for empty services."""
        result = format_service_status_summary({})

        assert result["overall_status"] == "unknown"
        assert result["service_count"] == 0
        assert result["services"] == {}
        assert "metrics" in result

    def test_format_summary_with_services(self):
        """Test formatting summary with actual services."""
        services = {
            "redis": MagicMock(
                status="healthy",
                response_time_ms=10.0,
                last_checked="2024-01-01T00:00:00Z",
                details={"version": "7.0"}
            ),
            "database": MagicMock(
                status="degraded",
                response_time_ms=None,
                last_checked="2024-01-01T00:00:00Z",
                details=None
            )
        }

        result = format_service_status_summary(services)

        assert result["overall_status"] == "degraded"
        assert result["service_count"] == 2

        # Check services formatting
        assert "redis" in result["services"]
        assert result["services"]["redis"]["status"] == "healthy"
        assert result["services"]["redis"]["response_time_ms"] == 10.0
        assert result["services"]["redis"]["has_details"] is True

        assert "database" in result["services"]
        assert result["services"]["database"]["status"] == "degraded"
        assert result["services"]["database"]["response_time_ms"] is None
        assert result["services"]["database"]["has_details"] is False

        # Check metrics
        assert result["metrics"]["total_services"] == 2
        assert result["metrics"]["healthy_services"] == 1
        assert result["metrics"]["degraded_services"] == 1