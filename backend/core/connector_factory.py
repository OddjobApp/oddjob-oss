"""
Connector Factory Utilities
Standardized factory utilities for creating SaaS connectors
"""

from typing import Dict, Any, Optional, TypeVar, Callable

from core.service_base import ServiceConfig
from core.saas_types import ConnectorCredentials

T = TypeVar('T')


def create_service_config(
    name: str = "connector",
    enabled: bool = True,
    timeout: int = 30,
    retry_attempts: int = 3,
    **extra_config
) -> ServiceConfig:
    """
    Create a standardized ServiceConfig for a connector.
    
    Args:
        name: The connector name
        enabled: Whether the connector is enabled
        timeout: Request timeout in seconds
        retry_attempts: Number of retry attempts for failed requests
        **extra_config: Additional configuration options
        
    Returns:
        A configured ServiceConfig instance
    """
    return ServiceConfig(
        name=name,
        enabled=enabled,
        timeout=timeout,
        retry_attempts=retry_attempts,
        **extra_config
    )


def create_connector_config(
    platform: str,
    config_overrides: Optional[Dict[str, Any]] = None
) -> ServiceConfig:
    """
    Create a connector config from overrides with sensible defaults.
    
    This extracts standard config fields from the overrides dict and
    passes the rest as extra configuration.
    
    Args:
        platform: The platform name (used for default naming)
        config_overrides: Optional configuration overrides
        
    Returns:
        A configured ServiceConfig instance
    """
    overrides = (config_overrides or {}).copy()
    
    # Extract standard fields with defaults
    name = overrides.pop("name", f"{platform}_connector")
    enabled = overrides.pop("enabled", True)
    timeout = overrides.pop("timeout", 30)
    retry_attempts = overrides.pop("retry_attempts", 3)
    
    return create_service_config(
        name=name,
        enabled=enabled,
        timeout=timeout,
        retry_attempts=retry_attempts,
        **overrides
    )


def create_basic_auth_credentials(
    username: Optional[str] = None,
    api_key: Optional[str] = None,
    password: Optional[str] = None
) -> ConnectorCredentials:
    """
    Create credentials for Basic Auth authentication.
    
    Args:
        username: The username or email
        api_key: The API key (preferred over password)
        password: The password (fallback)
        
    Returns:
        A ConnectorCredentials instance
    """
    return ConnectorCredentials(
        username=username,
        api_key=api_key or password,
        password=password
    )


def create_token_credentials(
    access_token: Optional[str] = None,
    refresh_token: Optional[str] = None
) -> ConnectorCredentials:
    """
    Create credentials for token-based authentication.
    
    Args:
        access_token: The access token
        refresh_token: The refresh token (for OAuth flows)
        
    Returns:
        A ConnectorCredentials instance
    """
    return ConnectorCredentials(
        access_token=access_token,
        refresh_token=refresh_token
    )


def create_oauth_credentials(
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
    access_token: Optional[str] = None,
    refresh_token: Optional[str] = None
) -> ConnectorCredentials:
    """
    Create credentials for OAuth authentication.
    
    Args:
        client_id: The OAuth client ID
        client_secret: The OAuth client secret
        access_token: The current access token
        refresh_token: The refresh token
        
    Returns:
        A ConnectorCredentials instance
    """
    return ConnectorCredentials(
        client_id=client_id,
        client_secret=client_secret,
        access_token=access_token,
        refresh_token=refresh_token
    )


def create_atlassian_credentials(
    username: Optional[str] = None,
    api_key: Optional[str] = None,
    access_token: Optional[str] = None
) -> ConnectorCredentials:
    """
    Create credentials for Atlassian Cloud APIs (Jira, Confluence).
    
    Atlassian Cloud uses email:api_token for Basic Auth.
    
    Args:
        username: The Atlassian email address
        api_key: The Atlassian API token
        access_token: Alternative access token (for OAuth)
        
    Returns:
        A ConnectorCredentials instance
    """
    return ConnectorCredentials(
        username=username,
        api_key=api_key,
        access_token=access_token
    )


def create_teams_credentials(
    client_id: Optional[str] = None,
    client_secret: Optional[str] = None,
    tenant_id: Optional[str] = None,
    access_token: Optional[str] = None,
    refresh_token: Optional[str] = None
) -> ConnectorCredentials:
    """
    Create credentials for Microsoft Teams (Graph API).
    
    Teams uses OAuth with Azure AD.
    
    Args:
        client_id: The Azure AD application client ID
        client_secret: The Azure AD application client secret
        tenant_id: The Azure AD tenant ID (stored in webhook_secret for convenience)
        access_token: The current access token
        refresh_token: The refresh token
        
    Returns:
        A ConnectorCredentials instance with tenant_id in webhook_secret
    """
    return ConnectorCredentials(
        client_id=client_id,
        client_secret=client_secret,
        webhook_secret=tenant_id,  # Store tenant_id here for convenience
        access_token=access_token,
        refresh_token=refresh_token
    )


def merge_credentials(
    existing: Optional[ConnectorCredentials],
    new_values: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Merge existing credentials with new values, preserving existing secrets
    when new values are empty.
    
    Args:
        existing: The existing credentials (may be None)
        new_values: Dict of new credential values
        
    Returns:
        Updated dict with merged credentials
    """
    if not existing:
        return new_values
    
    # Mapping of request keys to ConnectorCredentials attributes
    secret_fields = {
        "api_key": "api_key",
        "password": "password",
        "client_secret": "client_secret",
        "bot_token": "access_token",
        "access_token": "access_token",
        "refresh_token": "refresh_token"
    }
    
    result = new_values.copy()
    
    for req_key, attr_name in secret_fields.items():
        if req_key in result:
            val = result.get(req_key)
            if not val:
                # New value is empty, try to get from existing
                existing_val = getattr(existing, attr_name, None)
                if existing_val:
                    result[req_key] = existing_val
    
    return result
