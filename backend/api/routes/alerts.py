"""
Alert Management API Routes
CRUD operations for alert management and notification channels
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field

from core.error_tracking import error_tracker
from core.notifications import notification_manager, NotificationChannel
from core.auth_middleware import get_current_user
from core.api_responses import (
    success_response,
    error_response,
    paginated_response,
    not_found_response,
    validation_error_response
)

router = APIRouter()


# Pydantic models for API
class AlertResponse(BaseModel):
    id: str
    timestamp: str
    severity: str
    category: str
    title: str
    description: str
    reason: str
    error_code: Optional[str]
    endpoint: Optional[str]
    user_id: Optional[str]
    status: str
    acknowledged: bool
    acknowledged_by: Optional[str]
    acknowledged_at: Optional[str]
    resolved: bool
    resolved_at: Optional[str]
    resolution_notes: Optional[str]


class ErrorSummaryResponse(BaseModel):
    time_window_minutes: int
    total_errors: int
    errors_by_severity: Dict[str, int]
    errors_by_category: Dict[str, int]
    errors_by_endpoint: Dict[str, int]
    errors_by_user: Dict[str, int]
    most_common_error_codes: List[List[Any]]
    most_common_exception_types: List[List[Any]]
    error_rate_per_minute: float
    trending_errors: List[Dict[str, Any]]


class NotificationChannelRequest(BaseModel):
    type: str = Field(..., description="Channel type: 'email' or 'webhook'")
    name: str
    enabled: bool = True
    email_addresses: Optional[List[str]] = None
    webhook_url: Optional[str] = None
    webhook_headers: Optional[Dict[str, str]] = None
    severity_filter: Optional[List[str]] = None
    category_filter: Optional[List[str]] = None


class NotificationChannelResponse(BaseModel):
    id: str
    type: str
    name: str
    enabled: bool
    email_addresses: Optional[List[str]]
    webhook_url: Optional[str]
    webhook_headers: Optional[Dict[str, str]]
    severity_filter: Optional[List[str]]
    category_filter: Optional[List[str]]


class AlertAcknowledgeRequest(BaseModel):
    notes: Optional[str] = None


class AlertResolveRequest(BaseModel):
    notes: Optional[str] = None


class NotificationHistoryResponse(BaseModel):
    timestamp: str
    channel_id: str
    notification_type: str
    alert_id: str
    status: str
    error_message: Optional[str]


# Routes
@router.get("/alerts/active")
async def get_active_alerts(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Get all active alerts."""
    alerts = error_tracker.get_active_alerts()
    alert_responses = [AlertResponse(**alert) for alert in alerts]
    return success_response(
        data=alert_responses,
        message=f"Retrieved {len(alert_responses)} active alerts"
    )


@router.get("/alerts/history", response_model=List[AlertResponse])
async def get_alert_history(
    limit: int = Query(100, ge=1, le=1000),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get alert history."""
    alerts = error_tracker.alert_manager.get_alert_history(limit)
    return [AlertResponse(**alert) for alert in alerts]


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: str,
    request: AlertAcknowledgeRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Acknowledge an alert."""
    user_id = current_user.get('id') or current_user.get('user_id')
    if not user_id:
        return error_response("User ID not found", 400)

    success = error_tracker.acknowledge_alert(alert_id, user_id, request.notes)
    if not success:
        return not_found_response("Alert", alert_id)

    return success_response(
        message="Alert acknowledged successfully",
        data={"alert_id": alert_id, "acknowledged_by": user_id}
    )


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: str,
    request: AlertResolveRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Resolve an alert."""
    user_id = current_user.get('id') or current_user.get('user_id')
    if not user_id:
        raise HTTPException(status_code=400, detail="User ID not found")

    success = error_tracker.resolve_alert(alert_id, user_id, request.notes)
    if not success:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {"message": "Alert resolved successfully"}


@router.get("/errors/summary", response_model=ErrorSummaryResponse)
async def get_error_summary(
    minutes: int = Query(60, ge=1, le=1440),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get error summary statistics."""
    return ErrorSummaryResponse(**error_tracker.get_error_summary(minutes))


@router.get("/notifications/channels", response_model=List[NotificationChannelResponse])
async def get_notification_channels(current_user: Dict[str, Any] = Depends(get_current_user)):
    """Get all notification channels."""
    channels = notification_manager.get_channels()
    return [NotificationChannelResponse(**channel.__dict__) for channel in channels]


@router.post("/notifications/channels", response_model=NotificationChannelResponse)
async def create_notification_channel(
    channel: NotificationChannelRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Create a new notification channel."""
    # Validate channel data
    if channel.type not in ["email", "webhook"]:
        raise HTTPException(status_code=400, detail="Channel type must be 'email' or 'webhook'")

    if channel.type == "email" and not channel.email_addresses:
        raise HTTPException(status_code=400, detail="Email addresses required for email channels")

    if channel.type == "webhook" and not channel.webhook_url:
        raise HTTPException(status_code=400, detail="Webhook URL required for webhook channels")

    # Create channel
    import uuid
    channel_id = f"channel_{uuid.uuid4().hex[:8]}"

    notification_channel = NotificationChannel(
        id=channel_id,
        type=channel.type,
        name=channel.name,
        enabled=channel.enabled,
        email_addresses=channel.email_addresses,
        webhook_url=channel.webhook_url,
        webhook_headers=channel.webhook_headers,
        severity_filter=channel.severity_filter,
        category_filter=channel.category_filter
    )

    notification_manager.add_channel(notification_channel)

    return NotificationChannelResponse(**notification_channel.__dict__)


@router.put("/notifications/channels/{channel_id}")
async def update_notification_channel(
    channel_id: str,
    channel: NotificationChannelRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Update a notification channel."""
    # Remove existing channel
    if not notification_manager.remove_channel(channel_id):
        raise HTTPException(status_code=404, detail="Channel not found")

    # Create updated channel
    notification_channel = NotificationChannel(
        id=channel_id,
        type=channel.type,
        name=channel.name,
        enabled=channel.enabled,
        email_addresses=channel.email_addresses,
        webhook_url=channel.webhook_url,
        webhook_headers=channel.webhook_headers,
        severity_filter=channel.severity_filter,
        category_filter=channel.category_filter
    )

    notification_manager.add_channel(notification_channel)

    return {"message": "Channel updated successfully"}


@router.delete("/notifications/channels/{channel_id}")
async def delete_notification_channel(
    channel_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Delete a notification channel."""
    if not notification_manager.remove_channel(channel_id):
        raise HTTPException(status_code=404, detail="Channel not found")

    return {"message": "Channel deleted successfully"}


@router.post("/notifications/channels/{channel_id}/test")
async def test_notification_channel(
    channel_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Test a notification channel."""
    result = await notification_manager.test_channel(channel_id)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Test failed"))

    return {"message": result["message"]}


@router.get("/notifications/history", response_model=List[NotificationHistoryResponse])
async def get_notification_history(
    limit: int = Query(100, ge=1, le=1000),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Get notification history."""
    history = notification_manager.get_notification_history(limit)
@router.post("/notify")
async def send_unified_notification(
    payload: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Unified notification endpoint for all channels.
    Accepts: { type, title, description, reason, severity, category, target }
    """
    # Create an alert-like structure for the manager
    import uuid
    from datetime import datetime, timezone
    
    alert = {
        "id": f"notif_{uuid.uuid4().hex[:8]}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "severity": payload.get("severity", "medium"),
        "category": payload.get("category", "notification"),
        "title": payload.get("title", "Oddjob Notification"),
        "description": payload.get("description", ""),
        "reason": payload.get("reason", ""),
        "status": "active"
    }
    
    # If a specific target and type are provided, we can route specifically
    notif_type = payload.get("type") # 'slack', 'email', 'agentmail', 'webhook'
    target = payload.get("target")
    
    if notif_type and target:
        # Create a transient channel for this specific notification
        channel = NotificationChannel(
            id=f"temp_{notif_type}",
            type=notif_type,
            name=target,
            enabled=True,
            email_addresses=[target] if notif_type in ["email", "agentmail"] else None,
            webhook_url=target if notif_type in ["webhook", "slack"] else None
        )
        
        if notif_type == "email":
            await notification_manager._send_email_notification(channel, alert)
        elif notif_type == "webhook":
            await notification_manager._send_webhook_notification(channel, alert)
        elif notif_type == "slack":
            await notification_manager._send_slack_notification(channel, alert)
        elif notif_type == "agentmail":
            await notification_manager._send_agentmail_notification(channel, alert)
            
        return success_response(message=f"Notification sent via {notif_type}")
    
    # Fallback to general alert broadcasting
    await notification_manager.send_alert_notification(alert)
    return success_response(message="Notification broadcasted to all channels")