"""
Authentication Helper Utilities
Shared authentication utilities for SaaS connectors
"""

import base64
from typing import Optional


def create_basic_auth_header(username: str, password_or_token: str) -> str:
    """
    Create a Basic Auth header value from username and password/API token.
    
    This is commonly used for Atlassian Cloud APIs (Jira, Confluence) where
    the format is `email:api_token` base64 encoded.
    
    Args:
        username: The username or email address
        password_or_token: The password or API token
        
    Returns:
        The Authorization header value (e.g., "Basic dXNlcjpwYXNz")
    """
    auth_str = f"{username}:{password_or_token}"
    b64_auth = base64.b64encode(auth_str.encode()).decode()
    from core.structured_logging import get_structured_logger
    _log = get_structured_logger("auth_helpers")
    _log.debug(f"Created Basic Auth header for {username}")
    return f"Basic {b64_auth}"


def create_bearer_auth_header(token: str) -> str:
    """
    Create a Bearer Auth header value from an access token.
    
    Args:
        token: The access token
        
    Returns:
        The Authorization header value (e.g., "Bearer eyJ...")
    """
    return f"Bearer {token}"


def get_auth_header(
    username: Optional[str] = None,
    api_key: Optional[str] = None,
    access_token: Optional[str] = None
) -> Optional[str]:
    """
    Get the appropriate Authorization header based on available credentials.
    
    Prefers Basic Auth (username + api_key) over Bearer token.
    
    Args:
        username: The username or email (for Basic Auth)
        api_key: The API key or password (for Basic Auth)
        access_token: The access token (for Bearer Auth)
        
    Returns:
        The Authorization header value, or None if no credentials provided
    """
    if username and api_key:
        return create_basic_auth_header(username, api_key)
    elif access_token:
        return create_bearer_auth_header(access_token)
    return None


def validate_basic_auth_credentials(username: Optional[str], password_or_token: Optional[str]) -> bool:
    """
    Validate that Basic Auth credentials are present.
    
    Args:
        username: The username or email
        password_or_token: The password or API token
        
    Returns:
        True if both are present and non-empty, False otherwise
    """
    return bool(username and password_or_token)


def validate_bearer_token(token: Optional[str]) -> bool:
    """
    Validate that a bearer token is present.
    
    Args:
        token: The access token
        
    Returns:
        True if the token is present and non-empty, False otherwise
    """
    return bool(token)
