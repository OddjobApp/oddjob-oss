"""
API Versioning System
Version management, migration utilities, and backward compatibility
"""

import re
import json
from typing import Dict, List, Any, Optional, Callable, TypeVar, Union
from enum import Enum
from datetime import datetime, timezone
from pathlib import Path
from functools import wraps

from core.structured_logging import get_structured_logger
from core.api_responses import success_response, error_response

logger = get_structured_logger("api_versioning")


class APIVersion(Enum):
    """Supported API versions."""
    V1 = "v1"
    V2 = "v2"  # Future version

    @classmethod
    def from_string(cls, version_str: str) -> 'APIVersion':
        """Create APIVersion from string."""
        clean_version = version_str.lower().lstrip('v')
        for version in cls:
            if version.value.endswith(clean_version):
                return version
        raise ValueError(f"Unsupported API version: {version_str}")

    @property
    def major(self) -> int:
        """Get major version number."""
        match = re.search(r'v(\d+)', self.value)
        return int(match.group(1)) if match else 1

    @property
    def minor(self) -> int:
        """Get minor version number."""
        match = re.search(r'v\d+\.(\d+)', self.value)
        return int(match.group(1)) if match else 0


class VersionChangeType(Enum):
    """Types of version changes."""
    BREAKING = "breaking"      # Breaking changes (require migration)
    COMPATIBLE = "compatible"   # Backward compatible changes
    DEPRECATED = "deprecated"   # Features marked for removal
    NEW_FEATURE = "new_feature" # New features added


class APIVersionInfo:
    """Information about an API version."""

    def __init__(
        self,
        version: APIVersion,
        release_date: datetime,
        description: str,
        changes: List[Dict[str, Any]],
        supported_until: Optional[datetime] = None,
        migration_guide: Optional[str] = None
    ):
        self.version = version
        self.release_date = release_date
        self.description = description
        self.changes = changes
        self.supported_until = supported_until
        self.migration_guide = migration_guide

    def is_supported(self) -> bool:
        """Check if this version is still supported."""
        if not self.supported_until:
            return True
        return datetime.now(timezone.utc) < self.supported_until

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "version": self.version.value,
            "release_date": self.release_date.isoformat(),
            "description": self.description,
            "changes": self.changes,
            "supported_until": self.supported_until.isoformat() if self.supported_until else None,
            "migration_guide": self.migration_guide,
            "is_supported": self.is_supported()
        }


class APIMigration:
    """Represents a migration between API versions."""

    def __init__(
        self,
        from_version: APIVersion,
        to_version: APIVersion,
        migration_func: Callable[[Dict[str, Any]], Dict[str, Any]],
        description: str,
        change_type: VersionChangeType = VersionChangeType.BREAKING
    ):
        self.from_version = from_version
        self.to_version = to_version
        self.migration_func = migration_func
        self.description = description
        self.change_type = change_type

    async def migrate(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Apply migration to data."""
        try:
            logger.info(
                f"Applying migration: {self.from_version.value} -> {self.to_version.value}",
                extra={
                    "migration_from": self.from_version.value,
                    "migration_to": self.to_version.value,
                    "change_type": self.change_type.value
                }
            )
            return await self.migration_func(data)
        except Exception as e:
            logger.error(
                f"Migration failed: {self.from_version.value} -> {self.to_version.value}",
                extra={"error": str(e)}
            )
            raise


class VersionManager:
    """Manages API versioning and migrations."""

    def __init__(self):
        self.versions: Dict[APIVersion, APIVersionInfo] = {}
        self.migrations: List[APIMigration] = []
        self.current_version = APIVersion.V1
        self.logger = get_structured_logger("version_manager")

    def register_version(self, version_info: APIVersionInfo) -> None:
        """Register a new API version."""
        if version_info.version in self.versions:
            raise ValueError(f"Version {version_info.version.value} already registered")

        self.versions[version_info.version] = version_info
        self.logger.info(f"Registered API version: {version_info.version.value}")

    def register_migration(self, migration: APIMigration) -> None:
        """Register a migration between versions."""
        self.migrations.append(migration)
        self.logger.info(
            f"Registered migration: {migration.from_version.value} -> {migration.to_version.value}"
        )

    def get_version_info(self, version: APIVersion) -> Optional[APIVersionInfo]:
        """Get information about a specific version."""
        return self.versions.get(version)

    def get_supported_versions(self) -> List[APIVersion]:
        """Get all currently supported versions."""
        return [v for v in self.versions.keys() if self.versions[v].is_supported()]

    def get_migration_path(
        self,
        from_version: APIVersion,
        to_version: APIVersion
    ) -> List[APIMigration]:
        """Get the migration path between two versions."""
        if from_version == to_version:
            return []

        # Simple linear migration path for now
        # In a real system, this would handle complex migration graphs
        applicable_migrations = [
            m for m in self.migrations
            if m.from_version == from_version and m.to_version == to_version
        ]

        if not applicable_migrations:
            raise ValueError(f"No migration path found from {from_version.value} to {to_version.value}")

        return applicable_migrations

    async def migrate_data(
        self,
        data: Dict[str, Any],
        from_version: APIVersion,
        to_version: APIVersion
    ) -> Dict[str, Any]:
        """Migrate data from one version to another."""
        migration_path = self.get_migration_path(from_version, to_version)

        migrated_data = data.copy()
        for migration in migration_path:
            migrated_data = await migration.migrate(migrated_data)

        return migrated_data

    def get_version_from_request(self, request) -> APIVersion:
        """Extract API version from request."""
        # Check Accept header for version
        accept_header = getattr(request, 'headers', {}).get('accept', '')

        # Look for version in Accept header (e.g., application/vnd.api.v1+json)
        version_match = re.search(r'application/vnd\.api\.([^+]+)\+json', accept_header)
        if version_match:
            try:
                return APIVersion.from_string(version_match.group(1))
            except ValueError:
                pass

        # Check URL path for version (e.g., /api/v1/endpoint)
        path = getattr(request, 'url', {}).get('path', '')
        path_match = re.search(r'/api/([^/]+)/', path)
        if path_match:
            try:
                return APIVersion.from_string(path_match.group(1))
            except ValueError:
                pass

        # Default to current version
        return self.current_version


def api_version(version: APIVersion):
    """
    Decorator to specify API version for endpoints.

    Usage:
        @app.get("/endpoint")
        @api_version(APIVersion.V1)
        async def my_endpoint():
            pass
    """
    def decorator(func: Callable) -> Callable:
        func._api_version = version
        return func
    return decorator


def version_aware_endpoint(min_version: APIVersion = APIVersion.V1):
    """
    Decorator to make endpoints version-aware.

    Usage:
        @app.get("/endpoint")
        @version_aware_endpoint(APIVersion.V1)
        async def my_endpoint(request: Request, version_manager: VersionManager = Depends()):
            version = version_manager.get_version_from_request(request)
            # Handle version-specific logic
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Extract request and version manager from kwargs
            request = kwargs.get('request')
            version_manager = kwargs.get('version_manager')

            if request and version_manager:
                requested_version = version_manager.get_version_from_request(request)

                # Check if requested version is supported
                if requested_version not in version_manager.get_supported_versions():
                    return error_response(
                        f"API version {requested_version.value} is not supported",
                        406
                    )

                # Add version info to kwargs
                kwargs['_api_version'] = requested_version

            return await func(*args, **kwargs)

        wrapper._min_version = min_version
        return wrapper
    return decorator


class APIVersionRouter:
    """Router that handles API versioning."""

    def __init__(self, version_manager: VersionManager):
        self.version_manager = version_manager
        self.routes: Dict[str, Dict[APIVersion, Callable]] = {}
        self.logger = get_structured_logger("api_router")

    def add_route(
        self,
        path: str,
        methods: List[str],
        handler: Callable,
        versions: List[APIVersion]
    ) -> None:
        """Add a versioned route."""
        if path not in self.routes:
            self.routes[path] = {}

        for version in versions:
            if version in self.routes[path]:
                self.logger.warning(f"Route {path} for version {version.value} already exists")

            self.routes[path][version] = handler
            self.logger.info(f"Added route: {path} for version {version.value}")

    def get_handler(self, path: str, version: APIVersion) -> Optional[Callable]:
        """Get handler for path and version."""
        if path not in self.routes:
            return None

        # Try exact version match first
        if version in self.routes[path]:
            return self.routes[path][version]

        # Fall back to latest compatible version
        supported_versions = sorted(
            [v for v in self.routes[path].keys() if v.major <= version.major],
            key=lambda v: (v.major, v.minor),
            reverse=True
        )

        if supported_versions:
            fallback_version = supported_versions[0]
            self.logger.info(
                f"Using fallback version {fallback_version.value} for {version.value}"
            )
            return self.routes[path][fallback_version]

        return None


class MigrationStore:
    """Store for tracking applied migrations."""

    def __init__(self, storage_path: Path):
        self.storage_path = storage_path
        self.applied_migrations: Dict[str, datetime] = {}
        self._load_applied_migrations()

    def _load_applied_migrations(self) -> None:
        """Load applied migrations from storage."""
        if self.storage_path.exists():
            try:
                with open(self.storage_path, 'r') as f:
                    data = json.load(f)
                    for migration_id, timestamp_str in data.items():
                        self.applied_migrations[migration_id] = datetime.fromisoformat(timestamp_str)
            except Exception as e:
                logger.error(f"Failed to load migration store: {e}")

    def _save_applied_migrations(self) -> None:
        """Save applied migrations to storage."""
        try:
            data = {
                migration_id: timestamp.isoformat()
                for migration_id, timestamp in self.applied_migrations.items()
            }
            with open(self.storage_path, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save migration store: {e}")

    def is_applied(self, migration_id: str) -> bool:
        """Check if migration has been applied."""
        return migration_id in self.applied_migrations

    def mark_applied(self, migration_id: str) -> None:
        """Mark migration as applied."""
        self.applied_migrations[migration_id] = datetime.now(timezone.utc)
        self._save_applied_migrations()
        logger.info(f"Marked migration as applied: {migration_id}")

    def get_applied_migrations(self) -> List[str]:
        """Get list of applied migration IDs."""
        return list(self.applied_migrations.keys())


# Global version manager instance
version_manager = VersionManager()

# Initialize with current version
current_version_info = APIVersionInfo(
    version=APIVersion.V1,
    release_date=datetime(2024, 1, 1, tzinfo=timezone.utc),
    description="Initial API version with core functionality",
    changes=[
        {
            "type": VersionChangeType.NEW_FEATURE.value,
            "description": "Complete pipeline orchestration system"
        },
        {
            "type": VersionChangeType.NEW_FEATURE.value,
            "description": "AI agent integration and management"
        },
        {
            "type": VersionChangeType.NEW_FEATURE.value,
            "description": "Knowledge graph and search capabilities"
        }
    ]
)

version_manager.register_version(current_version_info)