"""
SaaS Connector Management API
REST endpoints for managing SaaS integrations and connectors

This module re-exports from the saas/ package for backward compatibility.
New code should import directly from api.routes.saas package.
"""

# Re-export the router and models from the package
from api.routes.saas import (
    router,
    ConnectorConfigRequest,
    ConnectorResponse,
    SyncRequest,
    SyncResponse,
    WebhookTestRequest,
    BidirectionalSyncConfigRequest,
    EventWorkflowRequest,
    TestConnectionRequest,
)

__all__ = [
    "router",
    "ConnectorConfigRequest",
    "ConnectorResponse",
    "SyncRequest",
    "SyncResponse",
    "WebhookTestRequest",
    "BidirectionalSyncConfigRequest",
    "EventWorkflowRequest",
    "TestConnectionRequest",
]
