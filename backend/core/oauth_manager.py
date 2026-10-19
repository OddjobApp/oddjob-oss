"""
OAuth Manager
Handles OAuth 2.0 authentication flows for SaaS integrations
"""

import secrets
import hashlib
import base64
from typing import Dict, Any, Optional, List
from urllib.parse import urlencode, urlparse, parse_qs
from datetime import datetime, timezone, timedelta
import asyncio

from core.structured_logging import get_structured_logger
from core.saas_connectors import ConnectorCredentials

logger = get_structured_logger("oauth_manager")


class OAuthState:
    """OAuth state management for CSRF protection."""

    def __init__(self):
        self.states: Dict[str, Dict[str, Any]] = {}

    def create_state(self, platform: str, user_id: str, metadata: Optional[Dict[str, Any]] = None) -> str:
        """Create a new OAuth state parameter."""
        state_token = secrets.token_urlsafe(32)

        self.states[state_token] = {
            "platform": platform,
            "user_id": user_id,
            "created_at": datetime.now(timezone.utc),
            "metadata": metadata or {}
        }

        return state_token

    def validate_state(self, state_token: str) -> Optional[Dict[str, Any]]:
        """Validate and consume an OAuth state parameter."""
        state_data = self.states.get(state_token)
        if not state_data:
            return None

        # Check if state is expired (5 minutes)
        if datetime.now(timezone.utc) - state_data["created_at"] > timedelta(minutes=5):
            del self.states[state_token]
            return None

        # Return and consume the state
        del self.states[state_token]
        return state_data

    def cleanup_expired_states(self) -> None:
        """Clean up expired state tokens."""
        current_time = datetime.now(timezone.utc)
        expired_states = [
            state_token for state_token, data in self.states.items()
            if current_time - data["created_at"] > timedelta(minutes=10)
        ]

        for state_token in expired_states:
            del self.states[state_token]

        if expired_states:
            logger.info(f"Cleaned up {len(expired_states)} expired OAuth states")


class OAuthProvider:
    """Configuration for an OAuth provider."""

    def __init__(
        self,
        name: str,
        authorization_url: str,
        token_url: str,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        scope: List[str],
        pkce_required: bool = False,
        additional_params: Optional[Dict[str, Any]] = None
    ):
        self.name = name
        self.authorization_url = authorization_url
        self.token_url = token_url
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.scope = scope
        self.pkce_required = pkce_required
        self.additional_params = additional_params or {}

    def get_authorization_url(self, state: str, code_challenge: Optional[str] = None) -> str:
        """Generate OAuth authorization URL."""
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.scope),
            "response_type": "code",
            "state": state,
            **self.additional_params
        }

        if code_challenge:
            params["code_challenge"] = code_challenge
            params["code_challenge_method"] = "S256"

        return f"{self.authorization_url}?{urlencode(params)}"

    def create_code_challenge(self, code_verifier: str) -> str:
        """Create PKCE code challenge from verifier."""
        if not self.pkce_required:
            return ""

        # Create SHA256 hash of code verifier
        hash_obj = hashlib.sha256(code_verifier.encode())
        digest = hash_obj.digest()

        # Base64 encode and make URL-safe
        challenge = base64.urlsafe_b64encode(digest).decode().rstrip("=")

        return challenge


class OAuthManager:
    """Central OAuth manager for handling authentication flows."""

    def __init__(self):
        self.providers: Dict[str, OAuthProvider] = {}
        self.states = OAuthState()
        self.code_verifiers: Dict[str, str] = {}  # state -> code_verifier
        self.logger = get_structured_logger("oauth_manager")

        # Start cleanup task
        self.cleanup_task = asyncio.create_task(self._periodic_cleanup())

    def register_provider(self, provider: OAuthProvider) -> None:
        """Register an OAuth provider."""
        self.providers[provider.name.lower()] = provider
        self.logger.info(f"Registered OAuth provider: {provider.name}")

    def get_provider(self, name: str) -> Optional[OAuthProvider]:
        """Get OAuth provider by name."""
        return self.providers.get(name.lower())

    def start_oauth_flow(
        self,
        provider_name: str,
        user_id: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Start OAuth authorization flow.

        Returns:
            Dict with authorization URL and state information
        """
        provider = self.get_provider(provider_name)
        if not provider:
            raise ValueError(f"OAuth provider '{provider_name}' not found")

        # Create state for CSRF protection
        state = self.states.create_state(provider_name, user_id, metadata)

        # Generate PKCE code verifier if required
        code_challenge = None
        if provider.pkce_required:
            code_verifier = secrets.token_urlsafe(32)
            self.code_verifiers[state] = code_verifier
            code_challenge = provider.create_code_challenge(code_verifier)

        # Generate authorization URL
        auth_url = provider.get_authorization_url(state, code_challenge)

        return {
            "authorization_url": auth_url,
            "state": state,
            "provider": provider_name,
            "expires_in": 300  # 5 minutes
        }

    async def complete_oauth_flow(
        self,
        provider_name: str,
        code: str,
        state: str
    ) -> ConnectorCredentials:
        """
        Complete OAuth flow and exchange code for tokens.

        Returns:
            ConnectorCredentials with access tokens
        """
        provider = self.get_provider(provider_name)
        if not provider:
            raise ValueError(f"OAuth provider '{provider_name}' not found")

        # Validate state
        state_data = self.states.validate_state(state)
        if not state_data:
            raise ValueError("Invalid or expired OAuth state")

        # Prepare token exchange request
        token_data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": provider.redirect_uri,
            "client_id": provider.client_id,
            "client_secret": provider.client_secret
        }

        # Add PKCE code verifier if used
        code_verifier = self.code_verifiers.get(state)
        if code_verifier:
            token_data["code_verifier"] = code_verifier
            del self.code_verifiers[state]

        try:
            import httpx

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    provider.token_url,
                    data=token_data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                )

                if response.status_code != 200:
                    raise ValueError(f"Token exchange failed: {response.text}")

                token_response = response.json()

                # Create credentials from token response
                credentials = ConnectorCredentials(
                    access_token=token_response.get("access_token"),
                    refresh_token=token_response.get("refresh_token"),
                    token_expires_at=self._calculate_expiry(token_response.get("expires_in")),
                    scopes=token_response.get("scope", "").split() if token_response.get("scope") else provider.scope
                )

                self.logger.info(
                    f"OAuth flow completed for {provider_name}",
                    extra={"provider": provider_name, "user_id": state_data["user_id"]}
                )

                return credentials

        except Exception as e:
            self.logger.error(f"OAuth token exchange failed: {e}")
            raise

    def _calculate_expiry(self, expires_in: Optional[int]) -> Optional[datetime]:
        """Calculate token expiry datetime."""
        if not expires_in:
            return None
        return datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    async def refresh_credentials(
        self,
        provider_name: str,
        credentials: ConnectorCredentials
    ) -> ConnectorCredentials:
        """
        Refresh OAuth credentials using refresh token.

        Returns:
            Updated credentials
        """
        provider = self.get_provider(provider_name)
        if not provider:
            raise ValueError(f"OAuth provider '{provider_name}' not found")

        if not credentials.refresh_token:
            raise ValueError("No refresh token available")

        try:
            import httpx

            token_data = {
                "grant_type": "refresh_token",
                "refresh_token": credentials.refresh_token,
                "client_id": provider.client_id,
                "client_secret": provider.client_secret
            }

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    provider.token_url,
                    data=token_data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                )

                if response.status_code != 200:
                    raise ValueError(f"Token refresh failed: {response.text}")

                token_response = response.json()

                # Update credentials
                credentials.access_token = token_response.get("access_token")
                credentials.refresh_token = token_response.get("refresh_token", credentials.refresh_token)
                credentials.token_expires_at = self._calculate_expiry(token_response.get("expires_in"))
                credentials.scopes = token_response.get("scope", "").split() if token_response.get("scope") else credentials.scopes

                self.logger.info(f"OAuth tokens refreshed for {provider_name}")

                return credentials

        except Exception as e:
            self.logger.error(f"OAuth token refresh failed: {e}")
            raise

    async def _periodic_cleanup(self) -> None:
        """Periodic cleanup of expired states and tokens."""
        while True:
            try:
                self.states.cleanup_expired_states()

                # Clean up expired code verifiers (older than 10 minutes)
                current_time = datetime.now(timezone.utc)
                expired_verifiers = [
                    state for state, data in self.states.states.items()
                    if current_time - data["created_at"] > timedelta(minutes=10)
                ]

                for state in expired_verifiers:
                    self.code_verifiers.pop(state, None)

                await asyncio.sleep(300)  # Clean up every 5 minutes

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"OAuth cleanup error: {e}")
                await asyncio.sleep(60)

    async def shutdown(self) -> None:
        """Shutdown the OAuth manager."""
        if self.cleanup_task:
            self.cleanup_task.cancel()
            try:
                await self.cleanup_task
            except asyncio.CancelledError:
                pass


# Global OAuth manager instance
oauth_manager = OAuthManager()

# Pre-configured OAuth providers (would be loaded from config in production)
def register_default_providers():
    """Register commonly used OAuth providers."""

    # GitHub OAuth
    github_provider = OAuthProvider(
        name="github",
        authorization_url="https://github.com/login/oauth/authorize",
        token_url="https://github.com/login/oauth/access_token",
        client_id="",  # Would be loaded from config
        client_secret="",  # Would be loaded from config
        redirect_uri="",  # Would be loaded from config
        scope=["repo", "user", "read:org"],
        pkce_required=True
    )
    oauth_manager.register_provider(github_provider)

    # Slack OAuth
    slack_provider = OAuthProvider(
        name="slack",
        authorization_url="https://slack.com/oauth/v2/authorize",
        token_url="https://slack.com/api/oauth.v2.access",
        client_id="",  # Would be loaded from config
        client_secret="",  # Would be loaded from config
        redirect_uri="",  # Would be loaded from config
        scope=["channels:read", "chat:write", "users:read"],
        additional_params={"user_scope": "identity.basic"}
    )
    oauth_manager.register_provider(slack_provider)

    # Microsoft (Teams) OAuth
    microsoft_provider = OAuthProvider(
        name="microsoft",
        authorization_url="https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        token_url="https://login.microsoftonline.com/common/oauth2/v2.0/token",
        client_id="",  # Would be loaded from config
        client_secret="",  # Would be loaded from config
        redirect_uri="",  # Would be loaded from config
        scope=["https://graph.microsoft.com/User.Read", "https://graph.microsoft.com/Team.ReadBasic.All"],
        pkce_required=True
    )
    oauth_manager.register_provider(microsoft_provider)

# Initialize default providers
register_default_providers()