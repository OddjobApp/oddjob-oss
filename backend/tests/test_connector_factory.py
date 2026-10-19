"""Tests for connector_factory module."""
import pytest

from core.connector_factory import (
    create_service_config,
    create_connector_config,
    create_basic_auth_credentials,
    create_token_credentials,
    create_oauth_credentials,
    create_atlassian_credentials,
    create_teams_credentials,
    merge_credentials,
)
from core.saas_types import ConnectorCredentials


class TestCreateServiceConfig:
    """Tests for create_service_config function."""
    
    def test_creates_config_with_defaults(self):
        """Should create config with default values."""
        config = create_service_config()
        
        assert config.name == "connector"
        assert config.enabled is True
        assert config.timeout == 30
        assert config.retry_attempts == 3
    
    def test_creates_config_with_custom_values(self):
        """Should create config with custom values."""
        config = create_service_config(
            name="jira",
            enabled=False,
            timeout=60,
            retry_attempts=5
        )
        
        assert config.name == "jira"
        assert config.enabled is False
        assert config.timeout == 60
        assert config.retry_attempts == 5
    
    def test_passes_extra_config(self):
        """Should pass extra configuration to ServiceConfig."""
        config = create_service_config(
            name="test",
            custom_field="custom_value"
        )
        
        assert config.name == "test"
        # Extra config is passed through **kwargs


class TestCreateConnectorConfig:
    """Tests for create_connector_config function."""
    
    def test_creates_config_from_platform_name(self):
        """Should create config using platform name for default naming."""
        config = create_connector_config("jira")
        
        assert config.name == "jira_connector"
        assert config.enabled is True
    
    def test_applies_overrides(self):
        """Should apply configuration overrides."""
        config = create_connector_config("jira", {
            "name": "custom_jira",
            "timeout": 45,
        })
        
        assert config.name == "custom_jira"
        assert config.timeout == 45


class TestCreateBasicAuthCredentials:
    """Tests for create_basic_auth_credentials function."""
    
    def test_creates_credentials_with_api_key(self):
        """Should create credentials with api_key."""
        creds = create_basic_auth_credentials(
            username="user",
            api_key="key123"
        )
        
        assert creds.username == "user"
        assert creds.api_key == "key123"
    
    def test_api_key_takes_precedence(self):
        """Should prefer api_key over password."""
        creds = create_basic_auth_credentials(
            username="user",
            api_key="api_key",
            password="password"
        )
        
        assert creds.api_key == "api_key"


class TestCreateTokenCredentials:
    """Tests for create_token_credentials function."""
    
    def test_creates_credentials_with_access_token(self):
        """Should create credentials with access_token."""
        creds = create_token_credentials(access_token="token123")
        
        assert creds.access_token == "token123"
    
    def test_creates_credentials_with_refresh_token(self):
        """Should create credentials with refresh_token."""
        creds = create_token_credentials(
            access_token="access",
            refresh_token="refresh"
        )
        
        assert creds.access_token == "access"
        assert creds.refresh_token == "refresh"


class TestCreateOAuthCredentials:
    """Tests for create_oauth_credentials function."""
    
    def test_creates_full_oauth_credentials(self):
        """Should create full OAuth credentials."""
        creds = create_oauth_credentials(
            client_id="client_id",
            client_secret="client_secret",
            access_token="access",
            refresh_token="refresh"
        )
        
        assert creds.client_id == "client_id"
        assert creds.client_secret == "client_secret"
        assert creds.access_token == "access"
        assert creds.refresh_token == "refresh"


class TestCreateAtlassianCredentials:
    """Tests for create_atlassian_credentials function."""
    
    def test_creates_atlassian_credentials(self):
        """Should create Atlassian-style credentials."""
        creds = create_atlassian_credentials(
            username="user@example.com",
            api_key="api_token"
        )
        
        assert creds.username == "user@example.com"
        assert creds.api_key == "api_token"


class TestCreateTeamsCredentials:
    """Tests for create_teams_credentials function."""
    
    def test_creates_teams_credentials(self):
        """Should create Teams/Azure AD credentials."""
        creds = create_teams_credentials(
            client_id="client",
            client_secret="secret",
            tenant_id="tenant"
        )
        
        assert creds.client_id == "client"
        assert creds.client_secret == "secret"
        # tenant_id stored in webhook_secret for convenience
        assert creds.webhook_secret == "tenant"


class TestMergeCredentials:
    """Tests for merge_credentials function."""
    
    def test_returns_new_values_when_no_existing(self):
        """Should return new values when no existing credentials."""
        new_values = {"api_key": "new_key"}
        result = merge_credentials(None, new_values)
        
        assert result == new_values
    
    def test_preserves_existing_when_new_empty(self):
        """Should preserve existing secrets when new values are empty."""
        existing = ConnectorCredentials(api_key="existing_key")
        new_values = {"api_key": ""}
        
        result = merge_credentials(existing, new_values)
        
        assert result["api_key"] == "existing_key"
    
    def test_uses_new_value_when_provided(self):
        """Should use new value when it's provided."""
        existing = ConnectorCredentials(api_key="old_key")
        new_values = {"api_key": "new_key"}
        
        result = merge_credentials(existing, new_values)
        
        assert result["api_key"] == "new_key"
    
    def test_handles_multiple_fields(self):
        """Should handle multiple credential fields."""
        existing = ConnectorCredentials(
            api_key="old_api_key",
            access_token="old_token"
        )
        new_values = {
            "api_key": "",  # Empty - should preserve
            "access_token": "new_token"  # New value - should use
        }
        
        result = merge_credentials(existing, new_values)
        
        assert result["api_key"] == "old_api_key"
        assert result["access_token"] == "new_token"
