"""Tests for auth_helpers module."""
import pytest
import base64

from core.auth_helpers import (
    create_basic_auth_header,
    create_bearer_auth_header,
    get_auth_header,
    validate_basic_auth_credentials,
    validate_bearer_token,
)


class TestCreateBasicAuthHeader:
    """Tests for create_basic_auth_header function."""
    
    def test_creates_valid_basic_auth_header(self):
        """Should create a valid Basic auth header."""
        header = create_basic_auth_header("user", "pass")
        
        # Verify format
        assert header.startswith("Basic ")
        
        # Verify encoding
        encoded = header[6:]  # Remove "Basic " prefix
        decoded = base64.b64decode(encoded).decode()
        assert decoded == "user:pass"
    
    def test_handles_email_as_username(self):
        """Should handle email addresses as usernames (Atlassian pattern)."""
        header = create_basic_auth_header("user@example.com", "api_token_123")
        
        encoded = header[6:]
        decoded = base64.b64decode(encoded).decode()
        assert decoded == "user@example.com:api_token_123"
    
    def test_handles_special_characters(self):
        """Should handle special characters in password."""
        header = create_basic_auth_header("user", "p@ss:word!")
        
        encoded = header[6:]
        decoded = base64.b64decode(encoded).decode()
        assert decoded == "user:p@ss:word!"


class TestCreateBearerAuthHeader:
    """Tests for create_bearer_auth_header function."""
    
    def test_creates_valid_bearer_header(self):
        """Should create a valid Bearer auth header."""
        header = create_bearer_auth_header("token123")
        assert header == "Bearer token123"
    
    def test_handles_jwt_token(self):
        """Should handle JWT-like tokens."""
        jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0"
        header = create_bearer_auth_header(jwt)
        assert header == f"Bearer {jwt}"


class TestGetAuthHeader:
    """Tests for get_auth_header function."""
    
    def test_returns_basic_auth_when_username_and_api_key(self):
        """Should return Basic auth when username and api_key provided."""
        header = get_auth_header(username="user", api_key="key")
        assert header.startswith("Basic ")
    
    def test_returns_bearer_when_only_access_token(self):
        """Should return Bearer auth when only access_token provided."""
        header = get_auth_header(access_token="token")
        assert header == "Bearer token"
    
    def test_prefers_basic_auth_over_bearer(self):
        """Should prefer Basic auth when both credentials provided."""
        header = get_auth_header(username="user", api_key="key", access_token="token")
        assert header.startswith("Basic ")
    
    def test_returns_none_when_no_credentials(self):
        """Should return None when no credentials provided."""
        header = get_auth_header()
        assert header is None
    
    def test_returns_none_when_partial_basic_auth(self):
        """Should return None when only username (no password) provided."""
        header = get_auth_header(username="user")
        assert header is None


class TestValidateBasicAuthCredentials:
    """Tests for validate_basic_auth_credentials function."""
    
    def test_returns_true_when_both_present(self):
        """Should return True when both credentials present."""
        assert validate_basic_auth_credentials("user", "pass") is True
    
    def test_returns_false_when_username_missing(self):
        """Should return False when username missing."""
        assert validate_basic_auth_credentials(None, "pass") is False
        assert validate_basic_auth_credentials("", "pass") is False
    
    def test_returns_false_when_password_missing(self):
        """Should return False when password missing."""
        assert validate_basic_auth_credentials("user", None) is False
        assert validate_basic_auth_credentials("user", "") is False
    
    def test_returns_false_when_both_missing(self):
        """Should return False when both missing."""
        assert validate_basic_auth_credentials(None, None) is False


class TestValidateBearerToken:
    """Tests for validate_bearer_token function."""
    
    def test_returns_true_when_token_present(self):
        """Should return True when token present."""
        assert validate_bearer_token("token123") is True
    
    def test_returns_false_when_token_missing(self):
        """Should return False when token missing."""
        assert validate_bearer_token(None) is False
        assert validate_bearer_token("") is False
