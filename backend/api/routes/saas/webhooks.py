"""
SaaS Webhook Routes
Endpoints for webhook handling and testing
"""

from typing import Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from core.service_auth import caller_org

from core.saas_connectors import connector_manager
from core.structured_logging import get_structured_logger

from .models import WebhookTestRequest

logger = get_structured_logger("saas_webhooks_api")

router = APIRouter()


@router.post("/connectors/{platform}/test-webhook")
async def test_webhook(platform: str, request: WebhookTestRequest, organization_id: int = Depends(caller_org)):
    """Test webhook processing for a connector."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found for org {organization_id}")

    try:
        payload = await connector.process_webhook(
            request.event_type,
            request.payload,
            f"test_{int(datetime.now().timestamp())}"
        )

        return {
            "success": True,
            "processed_payload": payload.processed_data,
            "event_id": payload.event_id,
            "timestamp": payload.timestamp.isoformat()
        }

    except Exception as e:
        logger.error(f"Webhook test failed for {platform}: {e}")
        raise HTTPException(status_code=400, detail=f"Webhook processing failed: {str(e)}")


@router.post("/webhook/{platform}")
async def handle_webhook(platform: str, payload: Dict[str, Any], background_tasks: BackgroundTasks, organization_id: int = Depends(caller_org)):
    """Handle incoming webhooks from SaaS platforms."""
    # Ensure state is loaded
    if organization_id not in connector_manager.org_connectors:
        await connector_manager.load_org_state(organization_id)
        
    connector = connector_manager.get_connector(organization_id, platform)
    if not connector:
        logger.warning(f"Received webhook for unknown platform: {platform} (Org {organization_id})")
        raise HTTPException(status_code=404, detail=f"Connector for platform '{platform}' not found for org {organization_id}")

    try:
        background_tasks.add_task(_process_webhook_background, connector, payload)

        return {"status": "webhook_queued", "platform": platform}

    except Exception as e:
        logger.error(f"Webhook processing failed for {platform}: {e}")
        raise HTTPException(status_code=500, detail="Webhook processing failed")


async def _process_webhook_background(connector, payload: Dict[str, Any]):
    """Background task to process webhook."""
    try:
        event_type = _determine_event_type(connector.platform_name, payload)

        processed_payload = await connector.process_webhook(
            event_type,
            payload,
            f"webhook_{int(datetime.now().timestamp())}"
        )

        logger.info(f"Processed webhook for {connector.platform_name}: {event_type}")

    except Exception as e:
        logger.error(f"Background webhook processing failed for {connector.platform_name}: {e}")


def _determine_event_type(platform: str, payload: Dict[str, Any]) -> str:
    """Determine webhook event type from payload."""
    if platform == "slack":
        return payload.get("type", "event")
    elif platform == "github":
        return payload.get("action", "push")
    elif platform == "jira":
        return payload.get("webhookEvent", "issue")
    elif platform == "teams":
        return payload.get("changeType", "message")
    else:
        return "custom"
