"""
Error Tracking and Alerting System
Comprehensive error monitoring, aggregation, and notification system
"""

import time
import asyncio
import json
from typing import Dict, Any, List, Optional, Callable
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from enum import Enum
from collections import defaultdict, Counter

from core.structured_logging import get_structured_logger, performance_monitor
from core.config import settings

logger = get_structured_logger("error_tracking")


class ErrorSeverity(Enum):
    """Error severity levels."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ErrorCategory(Enum):
    """Error categories for classification."""
    VALIDATION = "validation"
    AUTHENTICATION = "authentication"
    AUTHORIZATION = "authorization"
    EXTERNAL_SERVICE = "external_service"
    DATABASE = "database"
    NETWORK = "network"
    CONFIGURATION = "configuration"
    PROCESSING = "processing"
    RATE_LIMIT = "rate_limit"
    SYSTEM = "system"
    UNKNOWN = "unknown"


@dataclass
class ErrorEvent:
    """Represents a tracked error event."""
    id: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    severity: ErrorSeverity = ErrorSeverity.MEDIUM
    category: ErrorCategory = ErrorCategory.UNKNOWN

    # Error details
    error_code: Optional[str] = None
    error_message: str = ""
    exception_type: Optional[str] = None
    stack_trace: Optional[str] = None

    # Context information
    endpoint: Optional[str] = None
    method: Optional[str] = None
    user_id: Optional[str] = None
    request_id: Optional[str] = None
    correlation_id: Optional[str] = None
    ip_address: Optional[str] = None

    # Additional metadata
    metadata: Dict[str, Any] = field(default_factory=dict)
    tags: List[str] = field(default_factory=list)

    # Alerting
    alert_sent: bool = False
    alert_timestamp: Optional[datetime] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        data = asdict(self)
        data["timestamp"] = self.timestamp.isoformat()
        data["alert_timestamp"] = self.alert_timestamp.isoformat() if self.alert_timestamp else None
        data["severity"] = self.severity.value
        data["category"] = self.category.value
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ErrorEvent':
        """Create from dictionary."""
        # Convert string timestamps back to datetime
        if "timestamp" in data:
            data["timestamp"] = datetime.fromisoformat(data["timestamp"])
        if "alert_timestamp" in data and data["alert_timestamp"]:
            data["alert_timestamp"] = datetime.fromisoformat(data["alert_timestamp"])

        # Convert string enums back
        if "severity" in data:
            data["severity"] = ErrorSeverity(data["severity"])
        if "category" in data:
            data["category"] = ErrorCategory(data["category"])

        return cls(**data)


class ErrorAggregator:
    """Aggregates and analyzes error patterns."""

    def __init__(self):
        self.errors: List[ErrorEvent] = []
        self.max_errors = 10000  # Keep last 10k errors
        self.aggregation_window_minutes = 60

    def add_error(self, error: ErrorEvent) -> None:
        """Add an error to the aggregator."""
        self.errors.append(error)

        # Maintain size limit
        if len(self.errors) > self.max_errors:
            self.errors = self.errors[-self.max_errors:]

    def get_recent_errors(self, minutes: int = 60) -> List[ErrorEvent]:
        """Get errors from the last N minutes."""
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        return [e for e in self.errors if e.timestamp > cutoff]

    def get_error_summary(self, minutes: int = 60) -> Dict[str, Any]:
        """Get summary statistics of errors."""
        recent_errors = self.get_recent_errors(minutes)

        summary = {
            "time_window_minutes": minutes,
            "total_errors": len(recent_errors),
            "errors_by_severity": Counter(e.severity.value for e in recent_errors),
            "errors_by_category": Counter(e.category.value for e in recent_errors),
            "errors_by_endpoint": Counter(e.endpoint for e in recent_errors if e.endpoint),
            "errors_by_user": Counter(e.user_id for e in recent_errors if e.user_id),
            "most_common_error_codes": Counter(e.error_code for e in recent_errors if e.error_code).most_common(10),
            "most_common_exception_types": Counter(e.exception_type for e in recent_errors if e.exception_type).most_common(10),
        }

        # Calculate error rate per minute
        summary["error_rate_per_minute"] = len(recent_errors) / minutes if minutes > 0 else 0

        # Identify trending errors (errors that have increased in frequency)
        summary["trending_errors"] = self._identify_trending_errors(recent_errors)

        return summary

    def _identify_trending_errors(self, recent_errors: List[ErrorEvent]) -> List[Dict[str, Any]]:
        """Identify errors that are trending upward."""
        # Simple trending detection: errors that appear more frequently in recent half vs earlier half
        if len(recent_errors) < 10:
            return []

        midpoint = len(recent_errors) // 2
        early_errors = recent_errors[:midpoint]
        late_errors = recent_errors[midpoint:]

        early_counts = Counter((e.error_code, e.exception_type) for e in early_errors)
        late_counts = Counter((e.error_code, e.exception_type) for e in late_errors)

        trending = []
        for error_key, late_count in late_counts.items():
            early_count = early_counts.get(error_key, 0)
            if early_count == 0 and late_count >= 3:  # New errors appearing frequently
                trending.append({
                    "error_code": error_key[0],
                    "exception_type": error_key[1],
                    "early_count": early_count,
                    "late_count": late_count,
                    "trend": "new_spike"
                })
            elif late_count > early_count * 2 and late_count >= 5:  # Significant increase
                trending.append({
                    "error_code": error_key[0],
                    "exception_type": error_key[1],
                    "early_count": early_count,
                    "late_count": late_count,
                    "trend": "increasing"
                })

        return trending

    def should_trigger_alert(self, error: ErrorEvent) -> tuple[bool, str]:
        """Determine if an error should trigger an alert."""
        # Always alert on critical errors
        if error.severity == ErrorSeverity.CRITICAL:
            return True, "Critical error severity"

        # Alert on high severity errors if they occur frequently
        if error.severity == ErrorSeverity.HIGH:
            recent_similar = [e for e in self.get_recent_errors(30)
                            if e.error_code == error.error_code and e.severity == ErrorSeverity.HIGH]
            if len(recent_similar) >= 5:
                return True, f"High severity error occurred {len(recent_similar)} times in last 30 minutes"

        # Alert on authentication failures
        if error.category == ErrorCategory.AUTHENTICATION:
            recent_auth_errors = [e for e in self.get_recent_errors(15)
                                if e.category == ErrorCategory.AUTHENTICATION]
            if len(recent_auth_errors) >= 10:
                return True, f"Authentication errors: {len(recent_auth_errors)} in last 15 minutes"

        # Alert on rate limiting issues
        if error.category == ErrorCategory.RATE_LIMIT:
            recent_rate_errors = [e for e in self.get_recent_errors(10)
                                if e.category == ErrorCategory.RATE_LIMIT]
            if len(recent_rate_errors) >= 20:
                return True, f"Rate limit errors: {len(recent_rate_errors)} in last 10 minutes"

        # Alert on external service failures
        if error.category == ErrorCategory.EXTERNAL_SERVICE:
            recent_external_errors = [e for e in self.get_recent_errors(30)
                                    if e.category == ErrorCategory.EXTERNAL_SERVICE and e.error_code == error.error_code]
            if len(recent_external_errors) >= 3:
                return True, f"External service error recurring: {len(recent_external_errors)} times"

        return False, "No alert conditions met"


class AlertManager:
    """Manages alert creation, delivery, and lifecycle."""

    def __init__(self):
        self.active_alerts: Dict[str, Dict[str, Any]] = {}
        self.alert_history: List[Dict[str, Any]] = []
        self.max_history = 1000

    def create_alert(self, error_event: ErrorEvent, reason: str) -> Dict[str, Any]:
        """Create an alert from an error event."""
        alert_id = f"alert_{int(time.time())}_{error_event.id}"

        alert = {
            "id": alert_id,
            "error_event_id": error_event.id,
            "timestamp": datetime.now(timezone.utc),
            "severity": error_event.severity.value,
            "category": error_event.category.value,
            "title": f"{error_event.severity.value.upper()}: {error_event.error_message[:100]}",
            "description": error_event.error_message,
            "reason": reason,
            "error_code": error_event.error_code,
            "endpoint": error_event.endpoint,
            "user_id": error_event.user_id,
            "metadata": error_event.metadata,
            "status": "active",
            "acknowledged": False,
            "acknowledged_by": None,
            "acknowledged_at": None,
            "resolved": False,
            "resolved_at": None,
            "resolution_notes": None
        }

        self.active_alerts[alert_id] = alert
        self.alert_history.append(alert)

        # Maintain history size
        if len(self.alert_history) > self.max_history:
            self.alert_history = self.alert_history[-self.max_history:]

        # Mark error as alerted
        error_event.alert_sent = True
        error_event.alert_timestamp = alert["timestamp"]

        logger.warning(
            f"Alert created: {alert['title']}",
            extra={
                "alert_id": alert_id,
                "error_event_id": error_event.id,
                "severity": error_event.severity.value,
                "category": error_event.category.value,
                "reason": reason,
                "event": "alert_created"
            }
        )

        return alert

    def acknowledge_alert(self, alert_id: str, user_id: str, notes: Optional[str] = None) -> bool:
        """Acknowledge an alert."""
        if alert_id not in self.active_alerts:
            return False

        alert = self.active_alerts[alert_id]
        alert["acknowledged"] = True
        alert["acknowledged_by"] = user_id
        alert["acknowledged_at"] = datetime.now(timezone.utc)
        if notes:
            alert["resolution_notes"] = notes

        logger.info(
            f"Alert acknowledged: {alert_id}",
            extra={
                "alert_id": alert_id,
                "acknowledged_by": user_id,
                "event": "alert_acknowledged"
            }
        )

        return True

    def resolve_alert(self, alert_id: str, user_id: str, notes: Optional[str] = None) -> bool:
        """Resolve an alert."""
        if alert_id not in self.active_alerts:
            return False

        alert = self.active_alerts[alert_id]
        alert["resolved"] = True
        alert["resolved_at"] = datetime.now(timezone.utc)
        alert["status"] = "resolved"
        if notes:
            alert["resolution_notes"] = notes

        # Remove from active alerts
        del self.active_alerts[alert_id]

        logger.info(
            f"Alert resolved: {alert_id}",
            extra={
                "alert_id": alert_id,
                "resolved_by": user_id,
                "event": "alert_resolved"
            }
        )

        return True

    def get_active_alerts(self) -> List[Dict[str, Any]]:
        """Get all active alerts."""
        return list(self.active_alerts.values())

    def get_alert_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get recent alert history."""
        return self.alert_history[-limit:]

    async def send_notifications(self, alert: Dict[str, Any]) -> None:
        """Send notifications for an alert."""
        # This will be implemented in the notification system
        # For now, just log the alert
        logger.critical(
            f"ALERT: {alert['title']} - {alert['description']}",
            extra={
                "alert_id": alert['id'],
                "severity": alert['severity'],
                "event": "alert_notification_sent"
            }
        )


class ErrorTracker:
    """Main error tracking system."""

    def __init__(self):
        self.aggregator = ErrorAggregator()
        self.alert_manager = AlertManager()
        self._error_callbacks: List[Callable[[ErrorEvent], None]] = []

    def track_error(
        self,
        error: Exception,
        severity: ErrorSeverity = ErrorSeverity.MEDIUM,
        category: ErrorCategory = ErrorCategory.UNKNOWN,
        context: Optional[Dict[str, Any]] = None
    ) -> ErrorEvent:
        """Track an error event."""
        import uuid

        context = context or {}

        # Create error event
        error_event = ErrorEvent(
            id=f"err_{uuid.uuid4().hex[:16]}",
            severity=severity,
            category=category,
            error_message=str(error),
            exception_type=type(error).__name__,
            error_code=getattr(error, 'error_code', None),
            endpoint=context.get('endpoint'),
            method=context.get('method'),
            user_id=context.get('user_id'),
            request_id=context.get('request_id'),
            correlation_id=context.get('correlation_id'),
            ip_address=context.get('ip_address'),
            metadata=context.get('metadata', {}),
            tags=context.get('tags', [])
        )

        # Add stack trace for debugging
        import traceback
        error_event.stack_trace = ''.join(traceback.format_exception(type(error), error, error.__traceback__))

        # Add to aggregator
        self.aggregator.add_error(error_event)

        # Check if alert should be triggered
        should_alert, reason = self.aggregator.should_trigger_alert(error_event)
        if should_alert and not error_event.alert_sent:
            alert = self.alert_manager.create_alert(error_event, reason)
            # Send notifications asynchronously
            from core.notifications import notification_manager
            asyncio.create_task(notification_manager.send_alert_notification(alert))

        # Log the error
        logger.error(
            f"Error tracked: {error_event.error_message}",
            extra={
                "error_id": error_event.id,
                "severity": error_event.severity.value,
                "category": error_event.category.value,
                "error_code": error_event.error_code,
                "endpoint": error_event.endpoint,
                "user_id": error_event.user_id,
                "event": "error_tracked"
            }
        )

        # Call registered callbacks
        for callback in self._error_callbacks:
            try:
                callback(error_event)
            except Exception as e:
                logger.error(f"Error callback failed: {e}")

        return error_event

    def add_error_callback(self, callback: Callable[[ErrorEvent], None]) -> None:
        """Add a callback to be called when errors are tracked."""
        self._error_callbacks.append(callback)

    def get_error_summary(self, minutes: int = 60) -> Dict[str, Any]:
        """Get error summary statistics."""
        return self.aggregator.get_error_summary(minutes)

    def get_active_alerts(self) -> List[Dict[str, Any]]:
        """Get active alerts."""
        return self.alert_manager.get_active_alerts()

    def acknowledge_alert(self, alert_id: str, user_id: str, notes: Optional[str] = None) -> bool:
        """Acknowledge an alert."""
        return self.alert_manager.acknowledge_alert(alert_id, user_id, notes)

    def resolve_alert(self, alert_id: str, user_id: str, notes: Optional[str] = None) -> bool:
        """Resolve an alert."""
        return self.alert_manager.resolve_alert(alert_id, user_id, notes)


# Global error tracker instance
error_tracker = ErrorTracker()