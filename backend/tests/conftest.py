"""
Pytest configuration and shared fixtures
"""

import pytest
import asyncio
from typing import AsyncGenerator
from unittest.mock import AsyncMock

from core.testing_utils import (
    BaseTestCase,
    DatabaseTestCase,
    APITestCase,
    ServiceTestCase,
    TestDataFactory
)


# Global pytest configuration
def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line("markers", "unit: Unit tests")
    config.addinivalue_line("markers", "integration: Integration tests")
    config.addinivalue_line("markers", "slow: Slow running tests")
    config.addinivalue_line("markers", "api: API endpoint tests")
    config.addinivalue_line("markers", "database: Database-related tests")
    config.addinivalue_line("markers", "async: Async tests")


@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session", autouse=True)
async def setup_test_database():
    """Setup test database if needed."""
    # This would initialize test database schema
    # For now, just a placeholder
    yield


@pytest.fixture(scope="function", autouse=True)
async def cleanup_test_data():
    """Clean up test data after each test."""
    yield
    # Cleanup logic here


# Data factory fixtures
@pytest.fixture
def data_factory():
    """Test data factory."""
    return TestDataFactory()


# Common test data fixtures
@pytest.fixture
def sample_pipeline():
    """Sample pipeline data."""
    return TestDataFactory.create_pipeline()


@pytest.fixture
def sample_job():
    """Sample job data."""
    return TestDataFactory.create_job()


@pytest.fixture
def sample_user():
    """Sample user data."""
    return TestDataFactory.create_user()


@pytest.fixture
def sample_error():
    """Sample error event data."""
    return TestDataFactory.create_error_event()


# Mock fixtures
@pytest.fixture
def mock_async_client():
    """Mock async HTTP client."""
    client = AsyncMock()
    response = AsyncMock()
    response.status_code = 200
    response.json.return_value = {"status": "ok"}
    response.text = "OK"
    client.get.return_value = response
    client.post.return_value = response
    return client


@pytest.fixture
def mock_cache():
    """Mock cache manager."""
    cache = AsyncMock()
    cache.get.return_value = None
    cache.set.return_value = True
    cache.health_check.return_value = {"status": "healthy", "connected": True}
    return cache


@pytest.fixture
def mock_logger():
    """Mock logger."""
    logger = AsyncMock()
    logger.info.return_value = None
    logger.error.return_value = None
    logger.warning.return_value = None
    return logger