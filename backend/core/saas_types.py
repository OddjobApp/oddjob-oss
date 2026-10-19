"""
SaaS Connector Types
Dataclasses and enums for SaaS connector framework
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class ConnectorStatus(Enum):
    """Status of a SaaS connector."""
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    ERROR = "error"
    AUTHENTICATING = "authenticating"


class WebhookEvent(Enum):
    """Common webhook event types."""
    PUSH = "push"
    PULL_REQUEST = "pull_request"
    ISSUE = "issue"
    MESSAGE = "message"
    REACTION = "reaction"
    CUSTOM = "custom"


@dataclass
class ConnectorCredentials:
    """Credentials for SaaS connector authentication."""
    api_key: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    webhook_secret: Optional[str] = None

    # OAuth specific
    token_expires_at: Optional[datetime] = None
    scopes: List[str] = field(default_factory=list)

    def is_expired(self) -> bool:
        """Check if token is expired."""
        if not self.token_expires_at:
            return False
        return datetime.now(timezone.utc) >= self.token_expires_at

    def has_required_scopes(self, required_scopes: List[str]) -> bool:
        """Check if credentials have required OAuth scopes."""
        return all(scope in self.scopes for scope in required_scopes)


@dataclass
class WebhookPayload:
    """Standardized webhook payload structure."""
    event_type: WebhookEvent
    event_id: str
    timestamp: datetime
    source_platform: str
    raw_payload: Dict[str, Any]
    processed_data: Dict[str, Any] = field(default_factory=dict)

    # Routing information
    target_agent_id: Optional[str] = None
    workflow_id: Optional[str] = None
    priority: str = "normal"


class BidirectionalSyncConfig:
    """Configuration for bidirectional data synchronization."""

    def __init__(
        self,
        enabled: bool = False,
        sync_interval: int = 300,  # 5 minutes
        conflict_resolution: str = "last_write_wins",  # last_write_wins, manual, source_priority
        mappings: Optional[Dict[str, Dict[str, Any]]] = None
    ):
        self.enabled = enabled
        self.sync_interval = sync_interval
        self.conflict_resolution = conflict_resolution
        self.mappings = mappings or {}

    def should_sync(self, last_sync: Optional[datetime]) -> bool:
        """Check if sync should be performed based on interval."""
        if not last_sync:
            return True

        time_since_sync = (datetime.now(timezone.utc) - last_sync).total_seconds()
        return time_since_sync >= self.sync_interval


class EventDrivenWorkflow:
    """Configuration for event-driven workflows triggered by SaaS events."""

    def __init__(
        self,
        trigger_event: str,
        workflow_id: str,
        conditions: Optional[Dict[str, Any]] = None,
        transformation: Optional[Dict[str, Any]] = None,
        enabled: bool = True
    ):
        self.trigger_event = trigger_event
        self.workflow_id = workflow_id
        self.conditions = conditions or {}
        self.transformation = transformation or {}
        self.enabled = enabled

    def matches_event(self, event_type: str, event_data: Dict[str, Any]) -> bool:
        """Check if this workflow should be triggered by the event."""
        if not self.enabled or event_type != self.trigger_event:
            return False

        # Check conditions
        for key, expected_value in self.conditions.items():
            actual_value = event_data.get(key)
            if actual_value != expected_value:
                return False

        return True
