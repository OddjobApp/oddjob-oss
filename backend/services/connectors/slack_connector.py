"""
Slack SaaS Connector
Integration with Slack for real-time messaging and channel management
"""

from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

from core.service_base import ServiceConfig
from core.saas_connectors import (
    SaaSConnector,
    ConnectorCredentials,
    WebhookPayload,
    ConnectorStatus
)
from core.structured_logging import get_structured_logger

logger = get_structured_logger("slack_connector")


class SlackConnector(SaaSConnector):
    """Slack SaaS connector for real-time messaging and team collaboration."""

    def __init__(self, config: ServiceConfig, credentials: ConnectorCredentials):
        super().__init__(config, "slack", "https://slack.com/api", credentials)

    async def authenticate(self) -> bool:
        """Authenticate with Slack API."""
        if not self.credentials.access_token:
            self.status = ConnectorStatus.ERROR
            return False

        try:
            # Test authentication by getting team info
            response = await self.make_request("POST", "/auth.test")
            if response.get("ok"):
                self.status = ConnectorStatus.CONNECTED
                logger.info(f"Authenticated with Slack team: {response.get('team')}")
                return True
            else:
                logger.error(f"Slack authentication failed: {response.get('error')}")
                self.status = ConnectorStatus.ERROR
                return False
        except Exception as e:
            logger.error(f"Slack authentication failed: {e}")
            self.status = ConnectorStatus.ERROR
            return False

    async def validate_connection(self) -> bool:
        """Validate Slack connection."""
        try:
            response = await self.make_request("POST", "/auth.test")
            return response.get("ok", False)
        except Exception:
            return False

    async def get_user_profile(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Get Slack user profile."""
        if user_id:
            response = await self.make_request("GET", f"/users.info?user={user_id}")
            user = response.get("user", {})
        else:
            # Get current user info
            response = await self.make_request("POST", "/auth.test")
            user_id = response.get("user_id")
            if user_id:
                response = await self.make_request("GET", f"/users.info?user={user_id}")
                user = response.get("user", {})
            else:
                user = {}

        return {
            "id": user.get("id"),
            "name": user.get("name"),
            "real_name": user.get("real_name"),
            "display_name": user.get("profile", {}).get("display_name"),
            "email": user.get("profile", {}).get("email"),
            "avatar_url": user.get("profile", {}).get("image_192"),
            "status": user.get("profile", {}).get("status_text"),
            "timezone": user.get("tz"),
            "is_admin": user.get("is_admin", False),
            "is_owner": user.get("is_owner", False)
        }

    async def get_channels(self, types: str = "public_channel,private_channel") -> List[Dict[str, Any]]:
        """Get list of channels."""
        response = await self.make_request("GET", f"/conversations.list?types={types}")
        channels = response.get("channels", [])

        return [
            {
                "id": channel.get("id"),
                "name": channel.get("name"),
                "is_channel": channel.get("is_channel"),
                "is_group": channel.get("is_group"),
                "is_im": channel.get("is_im"),
                "created": channel.get("created"),
                "creator": channel.get("creator"),
                "members": channel.get("members", []),
                "topic": channel.get("topic", {}).get("value"),
                "purpose": channel.get("purpose", {}).get("value")
            }
            for channel in channels
        ]

    async def send_message(
        self,
        channel: str,
        text: str,
        thread_ts: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Send a message to a Slack channel."""
        data = {
            "channel": channel,
            "text": text
        }

        if thread_ts:
            data["thread_ts"] = thread_ts

        if attachments:
            data["attachments"] = attachments

        response = await self.make_request("POST", "/chat.postMessage", json=data)

        return {
            "ok": response.get("ok"),
            "channel": response.get("channel"),
            "ts": response.get("ts"),
            "message": response.get("message")
        }

    async def get_channel_messages(
        self,
        channel: str,
        limit: int = 100,
        oldest: Optional[str] = None,
        latest: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get messages from a channel."""
        params = f"/conversations.history?channel={channel}&limit={limit}"
        if oldest:
            params += f"&oldest={oldest}"
        if latest:
            params += f"&latest={latest}"

        response = await self.make_request("GET", params)
        messages = response.get("messages", [])

        return [
            {
                "ts": msg.get("ts"),
                "user": msg.get("user"),
                "text": msg.get("text"),
                "thread_ts": msg.get("thread_ts"),
                "reply_count": msg.get("reply_count"),
                "replies": msg.get("replies", []),
                "attachments": msg.get("attachments", []),
                "reactions": msg.get("reactions", [])
            }
            for msg in messages
        ]

    async def create_channel(
        self,
        name: str,
        is_private: bool = False,
        user_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Create a new Slack channel."""
        data = {
            "name": name,
            "is_private": is_private
        }

        if user_ids and is_private:
            data["user_ids"] = user_ids

        response = await self.make_request("POST", "/conversations.create", json=data)

        return {
            "ok": response.get("ok"),
            "channel": {
                "id": response.get("channel", {}).get("id"),
                "name": response.get("channel", {}).get("name"),
                "is_channel": response.get("channel", {}).get("is_channel"),
                "is_private": response.get("channel", {}).get("is_private")
            }
        }

    async def invite_to_channel(self, channel: str, user_ids: List[str]) -> Dict[str, Any]:
        """Invite users to a channel."""
        data = {
            "channel": channel,
            "users": ",".join(user_ids)
        }

        response = await self.make_request("POST", "/conversations.invite", json=data)

        return {
            "ok": response.get("ok"),
            "channel": response.get("channel"),
            "users": response.get("users", [])
        }

    async def _process_webhook_payload(self, payload: WebhookPayload) -> None:
        """Process Slack webhook payload."""
        event_data = payload.raw_payload

        if payload.event_type.value == "message":
            payload.processed_data = {
                "channel": event_data.get("channel"),
                "user": event_data.get("user"),
                "text": event_data.get("text"),
                "ts": event_data.get("ts"),
                "thread_ts": event_data.get("thread_ts"),
                "channel_type": event_data.get("channel_type"),
                "attachments": event_data.get("attachments", []),
                "files": event_data.get("files", []),
                "edited": event_data.get("edited"),
                "subtype": event_data.get("subtype")
            }

        elif payload.event_type.value == "reaction":
            payload.processed_data = {
                "type": event_data.get("type"),
                "user": event_data.get("user"),
                "reaction": event_data.get("reaction"),
                "item": event_data.get("item"),
                "item_user": event_data.get("item_user"),
                "event_ts": event_data.get("event_ts")
            }

    async def _perform_sync(
        self,
        sync_type: str,
        since: Optional[datetime],
        **kwargs
    ) -> Dict[str, Any]:
        """Perform data synchronization for Slack."""
        if sync_type == "channels":
            channels = await self.get_channels()
            return {
                "data": channels,
                "metadata": {
                    "total_channels": len(channels),
                    "sync_timestamp": datetime.now(timezone.utc).isoformat()
                }
            }

        elif sync_type == "messages":
            channel_id = kwargs.get("channel_id")
            if not channel_id:
                raise ValueError("channel_id required for message sync")

            oldest = since.timestamp() if since else None
            messages = await self.get_channel_messages(
                channel_id,
                limit=kwargs.get("limit", 100),
                oldest=str(oldest) if oldest else None
            )

            return {
                "data": messages,
                "metadata": {
                    "channel_id": channel_id,
                    "total_messages": len(messages),
                    "sync_timestamp": datetime.now(timezone.utc).isoformat(),
                    "since": since.isoformat() if since else None
                }
            }

        elif sync_type == "users":
            # Get all users in the workspace
            response = await self.make_request("GET", "/users.list")
            users = response.get("members", [])

            processed_users = [
                {
                    "id": user.get("id"),
                    "name": user.get("name"),
                    "real_name": user.get("real_name"),
                    "display_name": user.get("profile", {}).get("display_name"),
                    "email": user.get("profile", {}).get("email"),
                    "is_admin": user.get("is_admin"),
                    "is_owner": user.get("is_owner"),
                    "deleted": user.get("deleted"),
                    "status": user.get("profile", {}).get("status_text")
                }
                for user in users
            ]

            return {
                "data": processed_users,
                "metadata": {
                    "total_users": len(processed_users),
                    "sync_timestamp": datetime.now(timezone.utc).isoformat()
                }
            }

        else:
            raise ValueError(f"Unsupported sync type: {sync_type}")


from core.saas_registry import register_connector

# Factory function to create Slack connector
@register_connector("slack")
def create_slack_connector(
    bot_token: str,
    config_overrides: Optional[Dict[str, Any]] = None
) -> SlackConnector:
    """Create a Slack connector with bot token authentication."""
    overrides = (config_overrides or {}).copy()
    name = overrides.pop("name", "slack_connector")
    enabled = overrides.pop("enabled", True)
    
    timeout = overrides.pop("timeout", 30)
    retry_attempts = overrides.pop("retry_attempts", 3)
    
    config = ServiceConfig(
        name=name,
        enabled=enabled,
        timeout=timeout,
        retry_attempts=retry_attempts,
        **overrides
    )

    credentials = ConnectorCredentials(
        access_token=bot_token
    )

    return SlackConnector(config, credentials)