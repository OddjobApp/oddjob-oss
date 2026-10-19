"""
Notification Service Routes
"""

from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any
from core.auth_middleware import get_current_user
from services.intent_classifier import intent_classifier
from core.api_responses import success_response

router = APIRouter()

@router.post("/classify")
async def classify_intent(
    payload: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Classify the intent of a notification reply.
    Accepts: { text: string }
    """
    text = payload.get("text")
    if not text:
        raise HTTPException(status_code=400, detail="Text payload required")
        
    result = await intent_classifier.classify(text)
    return success_response(data=result)

@router.get("/health")
async def health_check():
    """
    Check the health of the notification engine.
    """
    from core.notifications import notification_manager
    from core.config import settings
    
    status = {
        "engine": "healthy",
        "agentmail": "configured" if settings.AGENTMAIL_API_KEY else "not_configured",
        "slack": "configured" if settings.SLACK_BOT_TOKEN else "not_configured",
        "templates": "ready"
    }
    
    return success_response(data=status)
