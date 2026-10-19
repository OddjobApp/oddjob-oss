"""
Base Service Classes
Common patterns for service initialization, error handling, and lifecycle management
"""

import logging
from typing import Any, Dict, Optional, TypeVar, Generic, Callable
from abc import ABC, abstractmethod
from contextlib import asynccontextmanager
import time
from datetime import datetime, timezone

from core.structured_logging import get_structured_logger
from core.error_patterns import ErrorHandler, ErrorContext, error_context
from core.config import settings

logger = get_structured_logger("services")

T = TypeVar('T')


class ServiceConfig:
    """Configuration base class for services."""

    def __init__(
        self,
        name: str,
        enabled: bool = True,
        timeout: int = 30,
        retry_attempts: int = 3,
        retry_delay: float = 1.0,
        health_check_interval: int = 60,
        **kwargs
    ):
        self.name = name
        self.enabled = enabled
        self.timeout = timeout
        self.retry_attempts = retry_attempts
        self.retry_delay = retry_delay
        self.health_check_interval = health_check_interval
        # Store any additional configuration
        for key, value in kwargs.items():
            setattr(self, key, value)


class ServiceHealth:
    """Health status for services."""

    def __init__(self, service_name: str):
        self.service_name = service_name
        self.healthy = False
        self.last_check = None
        self.response_time = None
        self.error_message = None
        self.metadata = {}

    def update_health(
        self,
        healthy: bool,
        response_time: Optional[float] = None,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Update health status."""
        self.healthy = healthy
        self.last_check = datetime.now(timezone.utc)
        self.response_time = response_time
        self.error_message = error_message
        if metadata:
            self.metadata.update(metadata)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "service_name": self.service_name,
            "healthy": self.healthy,
            "last_check": self.last_check.isoformat() if self.last_check else None,
            "response_time": self.response_time,
            "error_message": self.error_message,
            "metadata": self.metadata
        }


class BaseService(ABC):
    """Base class for all services with common functionality."""

    def __init__(self, config: ServiceConfig):
        self.config = config
        self.logger = get_structured_logger(f"service.{config.name}")
        self.health = ServiceHealth(config.name)
        self._initialized = False
        self._start_time = None

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the service. Must be implemented by subclasses."""
        pass

    @abstractmethod
    async def shutdown(self) -> None:
        """Shutdown the service. Must be implemented by subclasses."""
        pass

    async def ensure_initialized(self) -> None:
        """Ensure the service is initialized."""
        if not self._initialized:
            with error_context(f"initialize_{self.config.name}"):
                await self.initialize()
                self._initialized = True
                self._start_time = time.time()
                self.logger.info(f"Service {self.config.name} initialized successfully")

    async def health_check(self) -> ServiceHealth:
        """Perform health check."""
        if not self.config.enabled:
            self.health.update_health(False, error_message="Service disabled")
            return self.health

        try:
            start_time = time.time()
            await self._perform_health_check()
            response_time = time.time() - start_time

            self.health.update_health(True, response_time)
            self.logger.debug(f"Health check passed for {self.config.name}")

        except Exception as e:
            self.health.update_health(False, error_message=str(e))
            self.logger.warning(f"Health check failed for {self.config.name}: {e}")

        return self.health

    @abstractmethod
    async def _perform_health_check(self) -> None:
        """Perform actual health check. Must be implemented by subclasses."""
        pass

    async def get_metrics(self) -> Dict[str, Any]:
        """Get service metrics."""
        uptime = time.time() - self._start_time if self._start_time else 0

        return {
            "service_name": self.config.name,
            "uptime_seconds": uptime,
            "healthy": self.health.healthy,
            "last_health_check": self.health.last_check.isoformat() if self.health.last_check else None,
            "average_response_time": self.health.response_time,
            "config": {
                "enabled": self.config.enabled,
                "timeout": self.config.timeout,
                "retry_attempts": self.config.retry_attempts
            }
        }


class ExternalService(BaseService):
    """Base class for external service integrations."""

    def __init__(self, config: ServiceConfig, base_url: str, api_key: Optional[str] = None):
        super().__init__(config)
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key

    async def _perform_health_check(self) -> None:
        """Default health check for external services."""
        # Simple connectivity check - override in subclasses for more specific checks
        import httpx

        async with httpx.AsyncClient(timeout=self.config.timeout) as client:
            response = await client.get(f"{self.base_url}/health")
            response.raise_for_status()

    async def make_request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Make HTTP request to external service with error handling."""
        import httpx

        url = f"{self.base_url}/{endpoint.lstrip('/')}"

        headers = kwargs.get('headers', {})
        if self.api_key and 'Authorization' not in headers:
            headers['Authorization'] = f"Bearer {self.api_key}"

        kwargs['headers'] = headers
        kwargs['timeout'] = kwargs.get('timeout', self.config.timeout)

        with error_context(f"{self.config.name}_request", resource=endpoint):
            async with httpx.AsyncClient() as client:
                response = await client.request(method, url, **kwargs)
                response.raise_for_status()
                return response.json()


class AIService(ExternalService):
    """Base class for AI service integrations."""

    def __init__(
        self,
        config: ServiceConfig,
        base_url: str,
        api_key: str,
        model_name: str,
        max_tokens: int = 1000
    ):
        super().__init__(config, base_url, api_key)
        self.model_name = model_name
        self.max_tokens = max_tokens

    async def generate_text(
        self,
        prompt: str,
        temperature: float = 0.7,
        **kwargs
    ) -> str:
        """Generate text using AI service."""
        raise NotImplementedError("Subclasses must implement generate_text")

    async def analyze_text(
        self,
        text: str,
        task: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Analyze text using AI service."""
        raise NotImplementedError("Subclasses must implement analyze_text")


class DatabaseService(BaseService):
    """Base class for database service integrations."""

    def __init__(self, config: ServiceConfig, connection_string: str):
        super().__init__(config)
        self.connection_string = connection_string
        self._connection_pool = None

    @abstractmethod
    async def connect(self) -> None:
        """Establish database connection."""
        pass

    @abstractmethod
    async def disconnect(self) -> None:
        """Close database connection."""
        pass

    @abstractmethod
    async def execute_query(self, query: str, params: Optional[list] = None) -> list:
        """Execute database query."""
        pass

    async def initialize(self) -> None:
        """Initialize database service."""
        await self.connect()

    async def shutdown(self) -> None:
        """Shutdown database service."""
        await self.disconnect()

    async def _perform_health_check(self) -> None:
        """Perform database health check."""
        # Simple query to test connectivity
        await self.execute_query("SELECT 1")


class CacheService(BaseService):
    """Base class for cache service integrations."""

    def __init__(self, config: ServiceConfig, redis_url: str):
        super().__init__(config)
        self.redis_url = redis_url
        self._redis_client = None

    @abstractmethod
    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache."""
        pass

    @abstractmethod
    async def set(self, key: str, value: Any, ttl: Optional[int] = None) -> bool:
        """Set value in cache."""
        pass

    @abstractmethod
    async def delete(self, key: str) -> bool:
        """Delete value from cache."""
        pass

    async def get_or_set(
        self,
        key: str,
        default_func: Callable[[], T],
        ttl: Optional[int] = None
    ) -> T:
        """Get value from cache or set it using default function."""
        cached_value = await self.get(key)
        if cached_value is not None:
            return cached_value

        # Generate new value
        value = default_func() if not callable(default_func) else await default_func()
        await self.set(key, value, ttl)
        return value


class ServiceRegistry:
    """Registry for managing service instances."""

    def __init__(self):
        self.services: Dict[str, BaseService] = {}
        self.logger = get_structured_logger("service_registry")

    def register(self, service: BaseService) -> None:
        """Register a service instance."""
        if service.config.name in self.services:
            raise ValueError(f"Service {service.config.name} already registered")

        self.services[service.config.name] = service
        self.logger.info(f"Registered service: {service.config.name}")

    def get(self, name: str) -> Optional[BaseService]:
        """Get service by name."""
        return self.services.get(name)

    async def initialize_all(self) -> None:
        """Initialize all registered services."""
        self.logger.info(f"Initializing {len(self.services)} services")

        for service in self.services.values():
            if service.config.enabled:
                try:
                    await service.ensure_initialized()
                except Exception as e:
                    self.logger.error(f"Failed to initialize service {service.config.name}: {e}")
                    # Continue with other services

    async def shutdown_all(self) -> None:
        """Shutdown all registered services."""
        self.logger.info(f"Shutting down {len(self.services)} services")

        for service in reversed(list(self.services.values())):
            try:
                await service.shutdown()
                self.logger.info(f"Shutdown service: {service.config.name}")
            except Exception as e:
                self.logger.error(f"Failed to shutdown service {service.config.name}: {e}")

    async def health_check_all(self) -> Dict[str, ServiceHealth]:
        """Perform health checks on all services."""
        results = {}
        for service in self.services.values():
            if service.config.enabled:
                results[service.config.name] = await service.health_check()

        return results

    def get_service_metrics(self) -> Dict[str, Dict[str, Any]]:
        """Get metrics for all services."""
        import asyncio

        async def collect_metrics():
            metrics = {}
            for service in self.services.values():
                if service.config.enabled:
                    try:
                        metrics[service.config.name] = await service.get_metrics()
                    except Exception as e:
                        self.logger.error(f"Failed to get metrics for {service.config.name}: {e}")
                        metrics[service.config.name] = {"error": str(e)}
            return metrics

        # Run in new event loop if needed
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # We're in an async context, create task
                return asyncio.create_task(collect_metrics())
            else:
                return loop.run_until_complete(collect_metrics())
        except RuntimeError:
            # No event loop, create new one
            return asyncio.run(collect_metrics())


# Global service registry
service_registry = ServiceRegistry()