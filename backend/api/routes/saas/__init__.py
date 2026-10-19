"""
SaaS Routes Package
Split into logical sub-modules for better maintainability
"""

from fastapi import APIRouter

from .models import (
    ConnectorConfigRequest,
    ConnectorResponse,
    SyncRequest,
    SyncResponse,
    WebhookTestRequest,
    BidirectionalSyncConfigRequest,
    EventWorkflowRequest,
    TestConnectionRequest
)

from .connectors import router as connectors_router
from .sync import router as sync_router
from .webhooks import router as webhooks_router
from .advanced import router as advanced_router
from .actions import router as actions_router

# Main router that combines all sub-routers
router = APIRouter(prefix="/saas", tags=["saas"])

# Include sub-routers
router.include_router(connectors_router)
router.include_router(sync_router)
router.include_router(webhooks_router)
router.include_router(advanced_router)
router.include_router(actions_router)

__all__ = [
    "router",
    # Models
    "ConnectorConfigRequest",
    "ConnectorResponse", 
    "SyncRequest",
    "SyncResponse",
    "WebhookTestRequest",
    "BidirectionalSyncConfigRequest",
    "EventWorkflowRequest",
    "TestConnectionRequest",
]
