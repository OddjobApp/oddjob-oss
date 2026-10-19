"""
Notification Intent Classifier
Uses LLM to classify user intents from email or Slack replies.
"""

from typing import Dict, Any, Optional
import re
from core.structured_logging import get_structured_logger
from core.config import settings
import google.generativeai as genai

logger = get_structured_logger("intent_classifier")

class IntentClassifier:
    def __init__(self):
        # Initialize Gemini for classification
        if settings.GOOGLE_API_KEY:
            genai.configure(api_key=settings.GOOGLE_API_KEY)
            self.model = genai.GenerativeModel(getattr(settings, "GEMINI_MODEL", None) or 'gemini-1.5-flash')
        else:
            self.model = None

    async def classify(self, text: str) -> Dict[str, Any]:
        """
        Classify the intent of a message.
        Returns: { intent: 'approve'|'reject'|'steer'|'launch'|'unknown', confidence: float, entities: {} }
        """
        # Basic heuristic fallback
        heuristics = self._heuristic_classify(text)
        
        if not self.model:
            logger.warning("Gemini not configured, using heuristics for classification")
            return heuristics

        try:
            prompt = f"""
            Classify the following user reply to an automated notification.
            User Message: "{text}"

            The possible intents are:
            - approve: User is approving a request (e.g. "yes", "looks good", "APPROVE 123456")
            - reject: User is rejecting a request (e.g. "no", "stop", "REJECT 123456")
            - steer: User is providing guidance or steering a mission (e.g. "can you also check...", "try focusing on...")
            - launch: User wants to start a new process (e.g. "launch mission X", "run security audit")

            Return ONLY a JSON object with:
            {{
              "intent": "approve" | "reject" | "steer" | "launch" | "unknown",
              "confidence": 0.0-1.0,
              "passcode": "6-digit code if found",
              "reasoning": "short explanation"
            }}
            """
            
            response = await self.model.generate_content_async(prompt)
            # Simple JSON extraction
            match = re.search(r'\{.*\}', response.text, re.DOTALL)
            if match:
                import json
                result = json.loads(match.group(0))
                # Merge with heuristic passcode if LLM missed it
                if not result.get("passcode") and heuristics.get("passcode"):
                    result["passcode"] = heuristics["passcode"]
                return result
            
            return heuristics
        except Exception as e:
            logger.error(f"LLM classification failed: {e}")
            return heuristics

    def _heuristic_classify(self, text: str) -> Dict[str, Any]:
        """Classic regex-based fallback."""
        clean = text.lower().strip()
        
        # Simple passcode extraction
        passcode_match = re.search(r'\b(\d{6})\b', text)
        passcode = passcode_match.group(1) if passcode_match else None
        
        if any(x in clean for x in ["approve", "yes", "looks good", "ok", "confirm"]):
            return {"intent": "approve", "confidence": 0.8, "passcode": passcode}
        if any(x in clean for x in ["reject", "no", "stop", "cancel", "deny"]):
            return {"intent": "reject", "confidence": 0.8, "passcode": passcode}
        if any(x in clean for x in ["steer", "nudge", "guidance", "instead", "try"]):
            return {"intent": "steer", "confidence": 0.7, "passcode": passcode}
        if any(x in clean for x in ["launch", "run", "start"]):
            return {"intent": "launch", "confidence": 0.7, "passcode": passcode}
            
        return {"intent": "unknown", "confidence": 0.0, "passcode": passcode}

# Global instance
intent_classifier = IntentClassifier()
