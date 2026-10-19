"""
Microsoft Teams SaaS Connector
Integration with Microsoft Teams for channel communication and collaboration
"""

from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

from core.service_base import ServiceConfig
from core.saas_connectors import (
    OAuthConnector,
    ConnectorCredentials,
    WebhookPayload,
    ConnectorStatus
)
from core.structured_logging import get_structured_logger

logger = get_structured_logger("teams_connector")


class TeamsConnector(OAuthConnector):
    """Microsoft Teams SaaS connector for channel communication."""

    def __init__(
        self,
        config: ServiceConfig,
        credentials: ConnectorCredentials,
        oauth_config: Dict[str, Any]
    ):
        super().__init__(
            config,
            "microsoft_teams",
            "https://graph.microsoft.com/v1.0",
            credentials,
            oauth_config
        )

    async def authenticate(self) -> bool:
        """Authenticate with Microsoft Graph API."""
        try:
            # Test authentication by getting current user
            response = await self.make_authenticated_request("GET", "/me")
            if response.get("id"):
                self.status = ConnectorStatus.CONNECTED
                logger.info(f"Authenticated with Teams as: {response.get('displayName')}")
                return True
            else:
                logger.error("Teams authentication failed: Invalid response")
                self.status = ConnectorStatus.ERROR
                return False
        except Exception as e:
            logger.error(f"Teams authentication failed: {e}")
            self.status = ConnectorStatus.ERROR
            return False

    async def validate_connection(self) -> bool:
        """Validate Teams connection."""
        try:
            response = await self.make_authenticated_request("GET", "/me")
            return response.get("id") is not None
        except Exception:
            return False

    async def get_user_profile(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Get Teams user profile."""
        endpoint = f"/users/{user_id}" if user_id else "/me"
        response = await self.make_authenticated_request("GET", endpoint)

        return {
            "id": response.get("id"),
            "display_name": response.get("displayName"),
            "given_name": response.get("givenName"),
            "surname": response.get("surname"),
            "mail": response.get("mail"),
            "user_principal_name": response.get("userPrincipalName"),
            "job_title": response.get("jobTitle"),
            "department": response.get("department"),
            "office_location": response.get("officeLocation"),
            "mobile_phone": response.get("mobilePhone"),
            "business_phones": response.get("businessPhones", []),
            "preferred_language": response.get("preferredLanguage")
        }

    async def get_teams(self) -> List[Dict[str, Any]]:
        """Get list of teams the user is a member of."""
        response = await self.make_authenticated_request("GET", "/me/joinedTeams")

        teams = []
        for team in response.get("value", []):
            teams.append({
                "id": team.get("id"),
                "display_name": team.get("displayName"),
                "description": team.get("description"),
                "internal_id": team.get("internalId"),
                "classification": team.get("classification"),
                "specialization": team.get("specialization"),
                "visibility": team.get("visibility"),
                "is_archived": team.get("isArchived", False),
                "web_url": team.get("webUrl")
            })

        return teams

    async def get_channels(self, team_id: str) -> List[Dict[str, Any]]:
        """Get channels for a specific team."""
        response = await self.make_authenticated_request("GET", f"/teams/{team_id}/channels")

        channels = []
        for channel in response.get("value", []):
            channels.append({
                "id": channel.get("id"),
                "display_name": channel.get("displayName"),
                "description": channel.get("description"),
                "membership_type": channel.get("membershipType"),
                "web_url": channel.get("webUrl"),
                "email": channel.get("email"),
                "created_date_time": channel.get("createdDateTime"),
                "is_favorite_by_default": channel.get("isFavoriteByDefault", False)
            })

        return channels

    async def send_message(
        self,
        team_id: str,
        channel_id: str,
        content: str,
        content_type: str = "html",
        mentions: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Send a message to a Teams channel."""
        data = {
            "body": {
                "contentType": content_type,
                "content": content
            }
        }

        if mentions:
            data["mentions"] = mentions

        response = await self.make_authenticated_request(
            "POST",
            f"/teams/{team_id}/channels/{channel_id}/messages",
            json=data
        )

        return {
            "id": response.get("id"),
            "reply_to_id": response.get("replyToId"),
            "etag": response.get("etag"),
            "message_type": response.get("messageType"),
            "created_date_time": response.get("createdDateTime"),
            "last_modified_date_time": response.get("lastModifiedDateTime"),
            "body": response.get("body"),
            "from": response.get("from"),
            "attachments": response.get("attachments", [])
        }

    async def reply_to_message(
        self,
        team_id: str,
        channel_id: str,
        message_id: str,
        content: str,
        content_type: str = "html"
    ) -> Dict[str, Any]:
        """Reply to a message in a Teams channel."""
        data = {
            "body": {
                "contentType": content_type,
                "content": content
            }
        }

        response = await self.make_authenticated_request(
            "POST",
            f"/teams/{team_id}/channels/{channel_id}/messages/{message_id}/replies",
            json=data
        )

        return {
            "id": response.get("id"),
            "reply_to_id": response.get("replyToId"),
            "etag": response.get("etag"),
            "message_type": response.get("messageType"),
            "created_date_time": response.get("createdDateTime"),
            "last_modified_date_time": response.get("lastModifiedDateTime"),
            "body": response.get("body"),
            "from": response.get("from")
        }

    async def get_messages(
        self,
        team_id: str,
        channel_id: str,
        top: int = 50,
        filter_query: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get messages from a Teams channel."""
        params = f"?$top={top}"
        if filter_query:
            params += f"&$filter={filter_query}"

        response = await self.make_authenticated_request(
            "GET",
            f"/teams/{team_id}/channels/{channel_id}/messages{params}"
        )

        messages = []
        for message in response.get("value", []):
            messages.append({
                "id": message.get("id"),
                "reply_to_id": message.get("replyToId"),
                "etag": message.get("etag"),
                "message_type": message.get("messageType"),
                "created_date_time": message.get("createdDateTime"),
                "last_modified_date_time": message.get("lastModifiedDateTime"),
                "deleted_date_time": message.get("deletedDateTime"),
                "subject": message.get("subject"),
                "summary": message.get("summary"),
                "importance": message.get("importance"),
                "locale": message.get("locale"),
                "web_url": message.get("webUrl"),
                "policy_violation": message.get("policyViolation"),
                "from": message.get("from", {}).get("user", {}).get("displayName"),
                "from_id": message.get("from", {}).get("user", {}).get("id"),
                "body": message.get("body", {}).get("content"),
                "body_type": message.get("body", {}).get("contentType"),
                "attachments": message.get("attachments", []),
                "mentions": message.get("mentions", []),
                "reactions": message.get("reactions", [])
            })

        return messages

    async def get_message_replies(
        self,
        team_id: str,
        channel_id: str,
        message_id: str,
        top: int = 50
    ) -> List[Dict[str, Any]]:
        """Get replies to a specific message."""
        response = await self.make_authenticated_request(
            "GET",
            f"/teams/{team_id}/channels/{channel_id}/messages/{message_id}/replies?$top={top}"
        )

        replies = []
        for reply in response.get("value", []):
            replies.append({
                "id": reply.get("id"),
                "reply_to_id": reply.get("replyToId"),
                "etag": reply.get("etag"),
                "message_type": reply.get("messageType"),
                "created_date_time": reply.get("createdDateTime"),
                "last_modified_date_time": reply.get("lastModifiedDateTime"),
                "deleted_date_time": reply.get("deletedDateTime"),
                "from": reply.get("from", {}).get("user", {}).get("displayName"),
                "from_id": reply.get("from", {}).get("user", {}).get("id"),
                "body": reply.get("body", {}).get("content"),
                "body_type": reply.get("body", {}).get("contentType"),
                "attachments": reply.get("attachments", []),
                "mentions": reply.get("mentions", []),
                "reactions": reply.get("reactions", [])
            })

        return replies

    async def create_channel(
        self,
        team_id: str,
        display_name: str,
        description: str = "",
        membership_type: str = "standard"
    ) -> Dict[str, Any]:
        """Create a new channel in a team."""
        data = {
            "displayName": display_name,
            "description": description,
            "membershipType": membership_type
        }

        response = await self.make_authenticated_request(
            "POST",
            f"/teams/{team_id}/channels",
            json=data
        )

        return {
            "id": response.get("id"),
            "display_name": response.get("displayName"),
            "description": response.get("description"),
            "membership_type": response.get("membershipType"),
            "web_url": response.get("webUrl"),
            "email": response.get("email"),
            "created_date_time": response.get("createdDateTime")
        }

    async def add_team_member(
        self,
        team_id: str,
        user_id: str,
        roles: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Add a member to a team."""
        data = {
            "@odata.type": "#microsoft.graph.aadUserConversationMember",
            "roles": roles or [],
            "user@odata.bind": f"https://graph.microsoft.com/v1.0/users('{user_id}')"
        }

        response = await self.make_authenticated_request(
            "POST",
            f"/teams/{team_id}/members",
            json=data
        )

        return {
            "id": response.get("id"),
            "roles": response.get("roles", []),
            "display_name": response.get("displayName"),
            "user_id": response.get("userId"),
            "email": response.get("email")
        }

    async def create_meeting(
        self,
        subject: str,
        start_date_time: str,
        end_date_time: str,
        attendees: Optional[List[str]] = None,
        description: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create an online meeting."""
        data = {
            "subject": subject,
            "start": {
                "dateTime": start_date_time,
                "timeZone": "UTC"
            },
            "end": {
                "dateTime": end_date_time,
                "timeZone": "UTC"
            },
            "isOnlineMeeting": True,
            "onlineMeetingProvider": "teamsForBusiness"
        }

        if attendees:
            data["attendees"] = [
                {
                    "emailAddress": {"address": email},
                    "type": "required"
                }
                for email in attendees
            ]

        if description:
            data["body"] = {
                "contentType": "HTML",
                "content": description
            }

        response = await self.make_authenticated_request("POST", "/me/events", json=data)

        return {
            "id": response.get("id"),
            "subject": response.get("subject"),
            "start": response.get("start"),
            "end": response.get("end"),
            "web_link": response.get("webLink"),
            "online_meeting_url": response.get("onlineMeetingUrl"),
            "organizer": response.get("organizer", {}).get("emailAddress", {}).get("address")
        }

    async def _process_webhook_payload(self, payload: WebhookPayload) -> None:
        """Process Teams webhook payload."""
        event_data = payload.raw_payload

        # Teams webhooks typically come from Microsoft Graph change notifications
        if payload.event_type.value == "message":
            payload.processed_data = {
                "subscription_id": event_data.get("subscriptionId"),
                "change_type": event_data.get("changeType"),
                "resource": event_data.get("resource"),
                "resource_data": event_data.get("resourceData", {}),
                "client_state": event_data.get("clientState")
            }

        elif payload.event_type.value == "custom":
            # Handle other Teams events
            payload.processed_data = event_data

    async def _perform_sync(
        self,
        sync_type: str,
        since: Optional[datetime],
        **kwargs
    ) -> Dict[str, Any]:
        """Perform data synchronization for Teams."""
        if sync_type == "teams":
            teams = await self.get_teams()
            return {
                "data": teams,
                "metadata": {
                    "total_teams": len(teams),
                    "sync_timestamp": datetime.now(timezone.utc).isoformat()
                }
            }

        elif sync_type == "channels":
            team_id = kwargs.get("team_id")
            if not team_id:
                raise ValueError("team_id required for channel sync")

            channels = await self.get_channels(team_id)
            return {
                "data": channels,
                "metadata": {
                    "team_id": team_id,
                    "total_channels": len(channels),
                    "sync_timestamp": datetime.now(timezone.utc).isoformat()
                }
            }

        elif sync_type == "messages":
            team_id = kwargs.get("team_id")
            channel_id = kwargs.get("channel_id")
            if not team_id or not channel_id:
                raise ValueError("team_id and channel_id required for message sync")

            filter_query = None
            if since:
                # Filter messages since timestamp
                filter_query = f"lastModifiedDateTime gt {since.strftime('%Y-%m-%dT%H:%M:%SZ')}"

            messages = await self.get_messages(team_id, channel_id, filter_query=filter_query)
            return {
                "data": messages,
                "metadata": {
                    "team_id": team_id,
                    "channel_id": channel_id,
                    "total_messages": len(messages),
                    "sync_timestamp": datetime.now(timezone.utc).isoformat(),
                    "since": since.isoformat() if since else None
                }
            }

        else:
            raise ValueError(f"Unsupported sync type: {sync_type}")


from core.saas_registry import register_connector

# Factory function to create Teams connector
@register_connector("teams")
def create_teams_connector(
    client_id: str,
    client_secret: str,
    tenant_id: str,
    access_token: Optional[str] = None,
    refresh_token: Optional[str] = None,
    config_overrides: Optional[Dict[str, Any]] = None
) -> TeamsConnector:
    """Create a Microsoft Teams connector with OAuth authentication."""
    overrides = (config_overrides or {}).copy()
    name = overrides.pop("name", "teams_connector")
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

    # Microsoft Graph OAuth configuration
    oauth_config = {
        "authorization_url": f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize",
        "token_url": f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        "scopes": [
            "https://graph.microsoft.com/Channel.ReadBasic.All",
            "https://graph.microsoft.com/ChannelMessage.Read.All",
            "https://graph.microsoft.com/ChannelMessage.Send",
            "https://graph.microsoft.com/Team.ReadBasic.All",
            "https://graph.microsoft.com/User.Read",
            "https://graph.microsoft.com/OnlineMeetings.ReadWrite"
        ]
    }

    credentials = ConnectorCredentials(
        access_token=access_token,
        refresh_token=refresh_token,
        client_id=client_id,
        client_secret=client_secret
    )

    return TeamsConnector(config, credentials, oauth_config)