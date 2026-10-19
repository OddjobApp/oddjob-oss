"""
SaaS Connector Framework
Standardized integration architecture for external SaaS platforms

This module re-exports from the split modules for backward compatibility.
New code should import directly from:
- core.saas_types: ConnectorStatus, WebhookEvent, ConnectorCredentials, WebhookPayload, BidirectionalSyncConfig, EventDrivenWorkflow
- core.saas_base: SaaSConnector, OAuthConnector
- core.saas_manager: ConnectorManager, connector_manager
"""

# Re-export types
from core.saas_types import (
    ConnectorStatus,
    WebhookEvent,
    ConnectorCredentials,
    WebhookPayload,
    BidirectionalSyncConfig,
    EventDrivenWorkflow
)

# Re-export base classes
from core.saas_base import (
    SaaSConnector,
    OAuthConnector
)

# Re-export manager
from core.saas_manager import (
    ConnectorManager,
    connector_manager
)

# Re-export ServiceConfig for convenience
from core.service_base import ServiceConfig

__all__ = [
    # Types
    "ConnectorStatus",
    "WebhookEvent", 
    "ConnectorCredentials",
    "WebhookPayload",
    "BidirectionalSyncConfig",
    "EventDrivenWorkflow",
    # Base classes
    "SaaSConnector",
    "OAuthConnector",
    # Manager
    "ConnectorManager",
    "connector_manager",
    # Convenience re-exports
    "ServiceConfig",
]
