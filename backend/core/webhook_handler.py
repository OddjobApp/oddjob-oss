"""
Webhook Handler
Processes incoming webhooks from SaaS platforms and routes them appropriately
"""

import hmac
import hashlib
import json
from typing import Dict, Any, List, Optional, Callable, Awaitable
from datetime import datetime, timezone

from core.structured_logging import get_structured_logger
from core.saas_connectors import WebhookPayload, WebhookEvent

logger = get_structured_logger("webhook_handler")


class WebhookSignatureValidator:
    """Validates webhook signatures for security."""

    @staticmethod
    def validate_github_signature(
        payload: bytes,
        signature: str,
        secret: str
    ) -> bool:
        """Validate GitHub webhook signature."""
        if not signature.startswith("sha256="):
            return False

        expected_signature = hmac.new(
            secret.encode(),
            payload,
            hashlib.sha256
        ).hexdigest()

        return hmac.compare_digest(signature, f"sha256={expected_signature}")

    @staticmethod
    def validate_slack_signature(
        payload: bytes,
        signature: str,
        secret: str,
        timestamp: str
    ) -> bool:
        """Validate Slack webhook signature."""
        # Slack signature format: v0=timestamp.signature
        if not signature.startswith("v0="):
            return False

        # Create the basestring
        basestring = f"v0:{timestamp}:{payload.decode()}"

        # Calculate expected signature
        expected_signature = hmac.new(
            secret.encode(),
            basestring.encode(),
            hashlib.sha256
        ).hexdigest()

        return hmac.compare_digest(signature, f"v0={expected_signature}")

    @staticmethod
    def validate_generic_signature(
        payload: bytes,
        signature: str,
        secret: str,
        algorithm: str = "sha256"
    ) -> bool:
        """Validate generic webhook signature."""
        try:
            hash_func = getattr(hashlib, algorithm)
            expected_signature = hmac.new(
                secret.encode(),
                payload,
                hash_func
            ).hexdigest()

            # Remove algorithm prefix if present
            if "=" in signature:
                provided_signature = signature.split("=", 1)[1]
            else:
                provided_signature = signature

            return hmac.compare_digest(provided_signature, expected_signature)

        except AttributeError:
            logger.warning(f"Unsupported hash algorithm: {algorithm}")
            return False


class WebhookHandler:
    """Central webhook processing and routing system."""

    def __init__(self):
        self.route_handlers: Dict[str, Dict[str, Callable]] = {}
        self.signature_validators: Dict[str, Callable] = {
            "github": WebhookSignatureValidator.validate_github_signature,
            "slack": WebhookSignatureValidator.validate_slack_signature,
            "generic": WebhookSignatureValidator.validate_generic_signature
        }
        self.logger = get_structured_logger("webhook_handler")

    def register_route(
        self,
        platform: str,
        event_type: str,
        handler: Callable[[WebhookPayload], Awaitable[None]]
    ) -> None:
        """Register a webhook handler for a platform and event type."""
        if platform not in self.route_handlers:
            self.route_handlers[platform] = {}

        self.route_handlers[platform][event_type] = handler
        self.logger.info(f"Registered webhook handler: {platform}.{event_type}")

    async def process_webhook(
        self,
        platform: str,
        headers: Dict[str, str],
        body: bytes,
        query_params: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Process an incoming webhook.

        Args:
            platform: SaaS platform name
            headers: HTTP headers
            body: Raw request body
            query_params: URL query parameters

        Returns:
            Processing result
        """
        try:
            # Validate signature if present
            validation_result = await self._validate_webhook_signature(
                platform, headers, body
            )

            if not validation_result["valid"]:
                return {
                    "success": False,
                    "error": "Invalid webhook signature",
                    "details": validation_result
                }

            # Parse webhook payload
            try:
                payload_data = json.loads(body.decode('utf-8'))
            except json.JSONDecodeError:
                return {
                    "success": False,
                    "error": "Invalid JSON payload"
                }

            # Process webhook based on platform
            result = await self._route_webhook(platform, headers, payload_data, query_params)

            return {
                "success": True,
                "processed": True,
                "result": result
            }

        except Exception as e:
            self.logger.error(f"Webhook processing failed: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def _validate_webhook_signature(
        self,
        platform: str,
        headers: Dict[str, str],
        body: bytes
    ) -> Dict[str, Any]:
        """Validate webhook signature for security."""
        # Get signature validator for platform
        validator = self.signature_validators.get(platform)
        if not validator:
            # No validator configured, accept webhook
            return {"valid": True, "method": "no_validator"}

        # Extract signature components based on platform
        if platform == "github":
            signature = headers.get("X-Hub-Signature-256")
            secret = self._get_webhook_secret(platform)
            if signature and secret:
                valid = WebhookSignatureValidator.validate_github_signature(
                    body, signature, secret
                )
                return {"valid": valid, "method": "github"}

        elif platform == "slack":
            signature = headers.get("X-Slack-Signature")
            timestamp = headers.get("X-Slack-Request-Timestamp")
            secret = self._get_webhook_secret(platform)
            if signature and timestamp and secret:
                valid = WebhookSignatureValidator.validate_slack_signature(
                    body, signature, secret, timestamp
                )
                return {"valid": valid, "method": "slack"}

        # Generic validation or no validation
        return {"valid": True, "method": "unvalidated"}

    def _get_webhook_secret(self, platform: str) -> Optional[str]:
        """Get webhook secret for platform."""
        # In production, this would be loaded from secure configuration
        # For now, return None (no validation)
        secrets = {
            "github": None,  # Load from config
            "slack": None,   # Load from config
        }
        return secrets.get(platform)

    async def _route_webhook(
        self,
        platform: str,
        headers: Dict[str, str],
        payload: Dict[str, Any],
        query_params: Optional[Dict[str, str]]
    ) -> Dict[str, Any]:
        """Route webhook to appropriate handler."""
        # Extract event type from headers/payload
        event_type = self._extract_event_type(platform, headers, payload)

        # Get handler for platform and event
        handler = self.route_handlers.get(platform, {}).get(event_type)

        if not handler:
            self.logger.info(f"No handler found for {platform}.{event_type}")
            return {"handled": False, "reason": "no_handler"}

        # Create webhook payload
        webhook_payload = WebhookPayload(
            event_type=WebhookEvent(event_type.lower()) if hasattr(WebhookEvent, event_type.upper())
                     else WebhookEvent.CUSTOM,
            event_id=payload.get("id") or f"{platform}_{int(datetime.now().timestamp())}",
            timestamp=datetime.now(timezone.utc),
            source_platform=platform,
            raw_payload=payload
        )

        # Process payload based on platform
        await self._process_platform_payload(platform, webhook_payload)

        # Call handler
        try:
            await handler(webhook_payload)
            return {
                "handled": True,
                "event_type": event_type,
                "event_id": webhook_payload.event_id
            }
        except Exception as e:
            self.logger.error(f"Webhook handler error: {e}")
            return {
                "handled": False,
                "error": str(e),
                "event_type": event_type
            }

    def _extract_event_type(self, platform: str, headers: Dict[str, str], payload: Dict[str, Any]) -> str:
        """Extract event type from webhook headers/payload."""
        # Platform-specific event type extraction
        if platform == "github":
            return headers.get("X-GitHub-Event", "push")

        elif platform == "slack":
            return payload.get("type", "event")

        elif platform == "jira":
            return payload.get("webhookEvent", "issue_updated")

        elif platform == "microsoft":
            return payload.get("changeType", "updated")

        # Generic fallback
        return payload.get("event", "unknown")

    async def _process_platform_payload(self, platform: str, payload: WebhookPayload) -> None:
        """Process webhook payload based on platform-specific logic."""

        if platform == "github":
            # Extract GitHub-specific data
            if "repository" in payload.raw_payload:
                repo = payload.raw_payload["repository"]
                payload.processed_data = {
                    "repo_name": repo.get("full_name"),
                    "repo_url": repo.get("html_url"),
                    "action": payload.raw_payload.get("action"),
                    "sender": payload.raw_payload.get("sender", {}).get("login")
                }

        elif platform == "slack":
            # Extract Slack-specific data
            event = payload.raw_payload.get("event", {})
            payload.processed_data = {
                "channel": event.get("channel"),
                "user": event.get("user"),
                "text": event.get("text"),
                "timestamp": event.get("ts")
            }

        elif platform == "jira":
            # Extract Jira-specific data
            issue = payload.raw_payload.get("issue", {})
            payload.processed_data = {
                "issue_key": issue.get("key"),
                "issue_type": issue.get("fields", {}).get("issuetype", {}).get("name"),
                "project": issue.get("fields", {}).get("project", {}).get("key"),
                "status": issue.get("fields", {}).get("status", {}).get("name")
            }

        # Store processed data
        payload.processed_data = payload.processed_data or {}

    def get_registered_routes(self) -> Dict[str, List[str]]:
        """Get all registered webhook routes."""
        return {
            platform: list(handlers.keys())
            for platform, handlers in self.route_handlers.items()
        }


# Global webhook handler instance
webhook_handler = WebhookHandler()

# Utility functions for webhook processing
async def process_incoming_webhook(
    platform: str,
    headers: Dict[str, str],
    body: bytes,
    query_params: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Process an incoming webhook (convenience function)."""
    return await webhook_handler.process_webhook(platform, headers, body, query_params)


def register_webhook_route(
    platform: str,
    event_type: str,
    handler: Callable[[WebhookPayload], Awaitable[None]]
) -> None:
    """Register a webhook route (convenience function)."""
    webhook_handler.register_route(platform, event_type, handler)


def get_webhook_routes() -> Dict[str, List[str]]:
    """Get registered webhook routes (convenience function)."""
    return webhook_handler.get_registered_routes()