"""
SaaS Connector Base Classes
Abstract base classes for SaaS platform connectors
"""

import asyncio
from typing import Dict, List, Any, Optional, Callable
from abc import ABC, abstractmethod
from datetime import datetime, timezone, timedelta

from core.service_base import ExternalService, ServiceConfig
from core.structured_logging import get_structured_logger
from core.saas_types import (
    ConnectorStatus,
    ConnectorCredentials,
    WebhookEvent,
    WebhookPayload
)

logger = get_structured_logger("saas_base")


class SaaSConnector(ExternalService, ABC):
    """Base class for SaaS platform connectors."""

    def __init__(
        self,
        config: ServiceConfig,
        platform_name: str,
        base_url: str,
        credentials: ConnectorCredentials
    ):
        super().__init__(config, base_url)
        self.platform_name = platform_name
        self.credentials = credentials
        self.status = ConnectorStatus.DISCONNECTED
        self.last_sync: Optional[datetime] = None
        self.webhook_handlers: Dict[str, List[Callable]] = {}

    @property
    def platform(self) -> str:
        """Alias for platform_name for backward compatibility."""
        return self.platform_name

    @abstractmethod
    async def authenticate(self) -> bool:
        """Authenticate with the SaaS platform."""
        pass

    @abstractmethod
    async def validate_connection(self) -> bool:
        """Validate that the connection is working."""
        pass

    @abstractmethod
    async def get_user_profile(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Get user profile information."""
        pass

    async def initialize(self) -> None:
        """Initialize the connector."""
        success = await self.authenticate()
        if success:
            self.status = ConnectorStatus.CONNECTED
            logger.info(f"{self.platform_name} connector initialized successfully")
        else:
            self.status = ConnectorStatus.ERROR
            logger.error(f"Failed to initialize {self.platform_name} connector")

    async def _perform_health_check(self) -> None:
        """Perform connector health check."""
        is_valid = await self.validate_connection()
        if not is_valid:
            self.status = ConnectorStatus.ERROR
            raise Exception(f"{self.platform_name} connection validation failed")

    def register_webhook_handler(
        self,
        event_type: str,
        handler: Callable[[WebhookPayload], Any]
    ) -> None:
        """Register a webhook event handler."""
        if event_type not in self.webhook_handlers:
            self.webhook_handlers[event_type] = []
        self.webhook_handlers[event_type].append(handler)
        logger.info(f"Registered webhook handler for {event_type} on {self.platform_name}")

    async def process_webhook(
        self,
        event_type: str,
        raw_payload: Dict[str, Any],
        event_id: Optional[str] = None
    ) -> WebhookPayload:
        """Process an incoming webhook."""
        # Import here to avoid circular dependency
        from core.saas_manager import connector_manager
        
        payload = WebhookPayload(
            event_type=WebhookEvent(event_type.lower()) if hasattr(WebhookEvent, event_type.upper())
                       else WebhookEvent.CUSTOM,
            event_id=event_id or f"{self.platform_name}_{int(datetime.now().timestamp())}",
            timestamp=datetime.now(timezone.utc),
            source_platform=self.platform_name,
            raw_payload=raw_payload
        )

        # Process the payload
        await self._process_webhook_payload(payload)

        # Call registered handlers
        handlers = self.webhook_handlers.get(event_type, [])
        for handler in handlers:
            try:
                await handler(payload)
            except Exception as e:
                logger.error(f"Webhook handler error for {event_type}: {e}")

        # Trigger event-driven workflows
        try:
            triggered_workflows = await connector_manager.trigger_event_workflows(
                self.platform_name,
                event_type,
                payload.processed_data
            )
            if triggered_workflows:
                payload.processed_data["triggered_workflows"] = triggered_workflows
        except Exception as e:
            logger.error(f"Event workflow trigger error for {event_type}: {e}")

        return payload

    @abstractmethod
    async def _process_webhook_payload(self, payload: WebhookPayload) -> None:
        """Process webhook payload specific to the platform."""
        pass

    async def sync_data(
        self,
        sync_type: str,
        since: Optional[datetime] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Synchronize data from the SaaS platform.

        Args:
            sync_type: Type of data to sync (users, messages, issues, etc.)
            since: Sync data since this timestamp
            **kwargs: Additional sync parameters

        Returns:
            Sync results with metadata
        """
        try:
            logger.info(f"Starting {sync_type} sync for {self.platform_name}")

            results = await self._perform_sync(sync_type, since, **kwargs)

            self.last_sync = datetime.now(timezone.utc)

            logger.info(f"Completed {sync_type} sync for {self.platform_name}: {len(results.get('data', []))} items")

            return {
                "success": True,
                "sync_type": sync_type,
                "items_synced": len(results.get("data", [])),
                "last_sync": self.last_sync.isoformat(),
                "data": results.get("data", []),
                "metadata": results.get("metadata", {})
            }

        except Exception as e:
            logger.error(f"Sync failed for {self.platform_name}: {e}")
            return {
                "success": False,
                "error": str(e),
                "sync_type": sync_type
            }

    @abstractmethod
    async def _perform_sync(
        self,
        sync_type: str,
        since: Optional[datetime],
        **kwargs
    ) -> Dict[str, Any]:
        """Perform the actual data synchronization."""
        pass


class OAuthConnector(SaaSConnector):
    """Base class for OAuth-based SaaS connectors."""

    def __init__(
        self,
        config: ServiceConfig,
        platform_name: str,
        base_url: str,
        credentials: ConnectorCredentials,
        oauth_config: Dict[str, Any]
    ):
        super().__init__(config, platform_name, base_url, credentials)
        self.oauth_config = oauth_config
        self.token_refresh_task: Optional[asyncio.Task] = None

    async def authenticate(self) -> bool:
        """Perform OAuth authentication."""
        try:
            if self.credentials.access_token and not self.credentials.is_expired():
                # Token is still valid
                return True

            if self.credentials.refresh_token:
                # Refresh the token
                success = await self._refresh_token()
                if success:
                    self._schedule_token_refresh()
                    return True

            # Initial authentication required
            success = await self._perform_initial_auth()
            if success:
                self._schedule_token_refresh()
                return True

            return False

        except Exception as e:
            logger.error(f"OAuth authentication failed for {self.platform_name}: {e}")
            return False

    async def _refresh_token(self) -> bool:
        """Refresh OAuth access token."""
        try:
            refresh_url = self.oauth_config.get("token_url")
            if not refresh_url:
                return False

            data = {
                "grant_type": "refresh_token",
                "refresh_token": self.credentials.refresh_token,
                "client_id": self.credentials.client_id,
                "client_secret": self.credentials.client_secret
            }

            async with self.session.post(refresh_url, data=data) as response:
                if response.status == 200:
                    token_data = await response.json()
                    self.credentials.access_token = token_data.get("access_token")
                    self.credentials.refresh_token = token_data.get("refresh_token")
                    expires_in = token_data.get("expires_in", 3600)
                    self.credentials.token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
                    return True

            return False

        except Exception as e:
            logger.error(f"Token refresh failed for {self.platform_name}: {e}")
            return False

    async def _perform_initial_auth(self) -> bool:
        """Perform initial OAuth authentication."""
        # This would typically involve redirecting to OAuth provider
        # For API-based implementations, this might use client credentials flow
        logger.warning(f"Initial OAuth auth not implemented for {self.platform_name}")
        return False

    def _schedule_token_refresh(self) -> None:
        """Schedule automatic token refresh."""
        if self.token_refresh_task:
            self.token_refresh_task.cancel()

        # Refresh 5 minutes before expiry
        if self.credentials.token_expires_at:
            refresh_time = (self.credentials.token_expires_at - datetime.now(timezone.utc)).total_seconds() - 300
            if refresh_time > 0:
                self.token_refresh_task = asyncio.create_task(self._delayed_token_refresh(refresh_time))

    async def _delayed_token_refresh(self, delay: float) -> None:
        """Refresh token after delay."""
        await asyncio.sleep(delay)
        await self._refresh_token()

    async def make_authenticated_request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Make authenticated request with OAuth token."""
        if not self.credentials.access_token or self.credentials.is_expired():
            # Try to refresh token
            if not await self._refresh_token():
                raise Exception("No valid access token available")

        headers = kwargs.get("headers", {})
        headers["Authorization"] = f"Bearer {self.credentials.access_token}"
        kwargs["headers"] = headers

        return await self.make_request(method, endpoint, **kwargs)
