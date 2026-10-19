"""
SaaS Connector Registry
Provides a mechanism for connectors to register their factories dynamically.
"""
from typing import Dict, Any, Callable, Optional, Type
from core.structured_logging import get_structured_logger

logger = get_structured_logger("saas_registry")

class SaaSConnectorRegistry:
    """Registry for SaaS connector factories."""
    
    _factories: Dict[str, Callable[..., Any]] = {}
    
    @classmethod
    def register(cls, platform: str, factory: Callable[..., Any]) -> None:
        """Register a connector factory for a platform."""
        print(f"DEBUG: Registering factory for {platform}")
        cls._factories[platform.lower()] = factory
        logger.info(f"Registered factory for platform: {platform}")
        
    @classmethod
    def get_factory(cls, platform: str) -> Optional[Callable[..., Any]]:
        """Get a connector factory for a platform."""
        factory = cls._factories.get(platform.lower())
        print(f"DEBUG: Getting factory for {platform} -> {'Found' if factory else 'None'}")
        return factory
        
    @classmethod
    def get_supported_platforms(cls) -> list[str]:
        """Get list of supported platforms."""
        return list(cls._factories.keys())

# Decorator for easy registration
def register_connector(platform: str):
    def decorator(factory_func):
        SaaSConnectorRegistry.register(platform, factory_func)
        return factory_func
    return decorator
