"""
Testing Infrastructure
Comprehensive testing utilities, fixtures, and base classes
"""

import pytest
import asyncio
from typing import Dict, Any, List, Optional, AsyncGenerator
from unittest.mock import AsyncMock, MagicMock
import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx


class AsyncTestClient:
    """Async HTTP client for testing FastAPI applications."""

    def __init__(self, app: FastAPI):
        self.app = app
        self.client = TestClient(app)

    async def get(self, url: str, **kwargs) -> httpx.Response:
        """Make async GET request."""
        return await asyncio.get_event_loop().run_in_executor(
            None, lambda: self.client.get(url, **kwargs)
        )

    async def post(self, url: str, **kwargs) -> httpx.Response:
        """Make async POST request."""
        return await asyncio.get_event_loop().run_in_executor(
            None, lambda: self.client.post(url, **kwargs)
        )

    async def put(self, url: str, **kwargs) -> httpx.Response:
        """Make async PUT request."""
        return await asyncio.get_event_loop().run_in_executor(
            None, lambda: self.client.put(url, **kwargs)
        )

    async def delete(self, url: str, **kwargs) -> httpx.Response:
        """Make async DELETE request."""
        return await asyncio.get_event_loop().run_in_executor(
            None, lambda: self.client.delete(url, **kwargs)
        )


class BaseTestCase:
    """Base test case with common utilities."""

    @pytest.fixture(autouse=True)
    def setup_test_environment(self):
        """Setup test environment variables."""
        # Mock environment variables for testing
        import os
        os.environ.update({
            "ENVIRONMENT": "test",
            "DEBUG": "true",
            "LOG_LEVEL": "DEBUG",
            "DATABASE_URL": "postgresql://test:test@localhost:5432/test_db",
            "REDIS_URL": "redis://localhost:6379/1",
            "JWT_SECRET_KEY": "test-secret-key",
            "OPENAI_API_KEY": "test-openai-key",
            "ANTHROPIC_API_KEY": "test-anthropic-key"
        })

    @pytest.fixture
    def mock_cache_manager(self):
        """Mock cache manager for testing."""
        mock_cache = AsyncMock()
        mock_cache.get.return_value = None
        mock_cache.set.return_value = True
        mock_cache.delete.return_value = True
        mock_cache.health_check.return_value = {"status": "healthy"}
        return mock_cache

    @pytest.fixture
    def mock_error_tracker(self):
        """Mock error tracker for testing."""
        mock_tracker = MagicMock()
        mock_tracker.track_error.return_value = None
        return mock_tracker

    @pytest.fixture
    def sample_user_data(self) -> Dict[str, Any]:
        """Sample user data for testing."""
        return {
            "id": 1,
            "username": "testuser",
            "email": "test@example.com",
            "roles": ["user"],
            "permissions": ["read:pipelines", "write:pipelines"]
        }

    @pytest.fixture
    def sample_pipeline_data(self) -> Dict[str, Any]:
        """Sample pipeline data for testing."""
        return {
            "id": 1,
            "name": "Test Pipeline",
            "definition": {
                "steps": [
                    {
                        "id": "step1",
                        "type": "http_request",
                        "config": {"url": "https://api.example.com"}
                    }
                ]
            },
            "created_by": 1,
            "status": "active"
        }

    @pytest.fixture
    def sample_job_data(self) -> Dict[str, Any]:
        """Sample job data for testing."""
        return {
            "id": 1,
            "pipeline_id": 1,
            "status": "queued",
            "parameters": {"input": "test"},
            "created_by": 1
        }


class DatabaseTestCase(BaseTestCase):
    """Test case with database fixtures."""

    @pytest.fixture
    async def mock_db_connection(self):
        """Mock database connection for testing."""
        mock_conn = AsyncMock()

        # Mock common database operations
        mock_conn.fetchrow.return_value = None
        mock_conn.fetch.return_value = []
        mock_conn.execute.return_value = "INSERT 0 1"

        return mock_conn

    @pytest.fixture
    def mock_repositories(self, mock_db_connection):
        """Mock repositories for testing."""
        from core.repositories import create_repositories

        repos = create_repositories(mock_db_connection)

        # Configure mock returns
        repos['jobs'].get_ready_jobs.return_value = []
        repos['credentials'].get_credential_secret.return_value = "mock_secret"

        return repos


class APITestCase(BaseTestCase):
    """Test case for API endpoint testing."""

    @pytest.fixture
    def test_app(self) -> FastAPI:
        """Create test FastAPI application."""
        from main import create_application
        return create_application()

    @pytest.fixture
    def test_client(self, test_app) -> TestClient:
        """Create test client."""
        return TestClient(test_app)

    @pytest.fixture
    async def async_test_client(self, test_app) -> AsyncTestClient:
        """Create async test client."""
        return AsyncTestClient(test_app)

    @pytest.fixture
    def auth_headers(self, sample_user_data) -> Dict[str, str]:
        """Generate authentication headers for testing."""
        # Mock JWT token generation
        from core.auth import create_access_token
        token = create_access_token({"sub": str(sample_user_data["id"])})
        return {"Authorization": f"Bearer {token}"}


class ServiceTestCase(BaseTestCase):
    """Test case for service layer testing."""

    @pytest.fixture
    def mock_openai_client(self):
        """Mock OpenAI client."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "Mock response"
        mock_client.chat.completions.create.return_value = mock_response
        return mock_client

    @pytest.fixture
    def mock_anthropic_client(self):
        """Mock Anthropic client."""
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.content = [MagicMock()]
        mock_response.content[0].text = "Mock response"
        mock_client.messages.create.return_value = mock_response
        return mock_client

    @pytest.fixture
    def mock_httpx_client(self):
        """Mock HTTPX client for external requests."""
        mock_client = AsyncMock()
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok"}
        mock_response.text = "OK"
        mock_client.get.return_value = mock_response
        mock_client.post.return_value = mock_response
        return mock_client


# Test Data Factories
class TestDataFactory:
    """Factory for generating test data."""

    @staticmethod
    def create_pipeline(name: str = "Test Pipeline", **kwargs) -> Dict[str, Any]:
        """Create test pipeline data."""
        return {
            "id": kwargs.get("id", 1),
            "name": name,
            "definition": {
                "steps": [
                    {
                        "id": "step1",
                        "type": "http_request",
                        "config": {"url": "https://api.example.com"}
                    }
                ]
            },
            "created_by": kwargs.get("created_by", 1),
            "status": kwargs.get("status", "active"),
            "created_at": kwargs.get("created_at", "2024-01-01T00:00:00Z"),
            "updated_at": kwargs.get("updated_at", "2024-01-01T00:00:00Z")
        }

    @staticmethod
    def create_job(pipeline_id: int = 1, **kwargs) -> Dict[str, Any]:
        """Create test job data."""
        return {
            "id": kwargs.get("id", 1),
            "pipeline_id": pipeline_id,
            "status": kwargs.get("status", "queued"),
            "parameters": kwargs.get("parameters", {"input": "test"}),
            "created_by": kwargs.get("created_by", 1),
            "created_at": kwargs.get("created_at", "2024-01-01T00:00:00Z")
        }

    @staticmethod
    def create_user(**kwargs) -> Dict[str, Any]:
        """Create test user data."""
        return {
            "id": kwargs.get("id", 1),
            "username": kwargs.get("username", "testuser"),
            "email": kwargs.get("email", "test@example.com"),
            "roles": kwargs.get("roles", ["user"]),
            "permissions": kwargs.get("permissions", ["read:pipelines"]),
            "created_at": kwargs.get("created_at", "2024-01-01T00:00:00Z")
        }

    @staticmethod
    def create_error_event(**kwargs) -> Dict[str, Any]:
        """Create test error event data."""
        return {
            "id": kwargs.get("id", "err_123"),
            "severity": kwargs.get("severity", "medium"),
            "category": kwargs.get("category", "processing"),
            "error_message": kwargs.get("error_message", "Test error"),
            "endpoint": kwargs.get("endpoint", "/api/test"),
            "user_id": kwargs.get("user_id", 1),
            "timestamp": kwargs.get("timestamp", "2024-01-01T00:00:00Z")
        }


# Test Utilities
def load_json_fixture(filename: str) -> Dict[str, Any]:
    """Load JSON fixture file."""
    fixture_path = Path(__file__).parent / "fixtures" / filename
    with open(fixture_path, 'r') as f:
        return json.load(f)


def create_mock_response(status_code: int = 200, json_data: Optional[Dict] = None) -> MagicMock:
    """Create mock HTTP response."""
    mock_response = MagicMock()
    mock_response.status_code = status_code
    mock_response.json.return_value = json_data or {}
    mock_response.text = json.dumps(json_data) if json_data else ""
    return mock_response


async def async_none(*args, **kwargs):
    """Async function that returns None."""
    return None


def assert_response_success(response: Dict[str, Any]) -> None:
    """Assert that API response indicates success."""
    assert "error" not in response
    assert response.get("status") in ["success", "healthy", "completed"]


def assert_response_error(response: Dict[str, Any]) -> None:
    """Assert that API response indicates error."""
    assert "error" in response or response.get("status") in ["error", "failed"]


# Performance Testing Utilities
class PerformanceTestMixin:
    """Mixin for performance testing."""

    async def measure_execution_time(self, func, *args, **kwargs) -> tuple[Any, float]:
        """Measure execution time of an async function."""
        import time
        start_time = time.time()
        result = await func(*args, **kwargs)
        execution_time = time.time() - start_time
        return result, execution_time

    def assert_performance(self, execution_time: float, max_time: float) -> None:
        """Assert that execution time is within acceptable limits."""
        assert execution_time <= max_time, f"Execution took {execution_time:.2f}s, max allowed: {max_time:.2f}s"