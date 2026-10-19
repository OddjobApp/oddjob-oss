"""
Database Repositories
Abstract database operations using repository pattern
"""

from typing import Dict, Any, List, Optional
import asyncpg
from datetime import datetime
from core.logging import get_logger

logger = get_logger(__name__)


class BaseRepository:
    """Base class for database repositories."""

    def __init__(self, connection: asyncpg.Connection):
        self.conn = connection


class JobRepository(BaseRepository):
    """Repository for job-related database operations."""

    async def get_ready_jobs(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get jobs that are ready to be processed."""
        try:
            jobs = await self.conn.fetch("""
                SELECT j.*, p.definition
                FROM jobs j
                JOIN pipelines p ON j.pipeline_id = p.id
                WHERE j.status = 'queued'
                ORDER BY j.created_at ASC
                LIMIT $1
            """, limit)

            return [dict(job) for job in jobs]
        except Exception as e:
            logger.error(f"Failed to get ready jobs: {e}")
            return []

    async def update_job_status(self, job_id: int, status: str, error_message: Optional[str] = None) -> bool:
        """Update job status."""
        try:
            await self.conn.execute("""
                UPDATE jobs
                SET status = $1, error_message = $2, updated_at = NOW()
                WHERE id = $3
            """, status, error_message, job_id)
            return True
        except Exception as e:
            logger.error(f"Failed to update job status: {e}")
            return False

    async def get_job_storage_info(self, job_id: int) -> Optional[Dict[str, Any]]:
        """Get job storage information."""
        try:
            result = await self.conn.fetchrow("""
                SELECT storage_path, storage_type
                FROM job_storage
                WHERE job_id = $1
            """, job_id)
            return dict(result) if result else None
        except Exception as e:
            logger.error(f"Failed to get job storage info: {e}")
            return None


class CredentialRepository(BaseRepository):
    """Repository for credential-related database operations."""

    async def get_credential_secret(self, credential_id: int) -> Optional[str]:
        """Get secret value for a credential from environment variables."""
        try:
            credential = await self.conn.fetchrow(
                "SELECT env_var_name FROM credentials WHERE id = $1",
                credential_id
            )
            if not credential:
                return None

            import os
            env_var_name = credential["env_var_name"]
            return os.getenv(env_var_name)
        except Exception as e:
            logger.error(f"Failed to get credential secret: {e}")
            return None


class AlertRepository(BaseRepository):
    """Repository for alert-related database operations."""

    async def create_alert(self, alert_data: Dict[str, Any]) -> bool:
        """Create a new alert in the database."""
        try:
            await self.conn.execute("""
                INSERT INTO alerts (
                    severity, category, title, description,
                    error_code, endpoint, user_id, metadata,
                    created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
                alert_data.get('severity'),
                alert_data.get('category'),
                alert_data.get('title'),
                alert_data.get('description'),
                alert_data.get('error_code'),
                alert_data.get('endpoint'),
                alert_data.get('user_id'),
                alert_data.get('metadata', {}),
                datetime.now()
            )
            return True
        except Exception as e:
            logger.error(f"Failed to create alert: {e}")
            return False


class UserRepository(BaseRepository):
    """Repository for user-related database operations."""

    async def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Get user information by ID."""
        try:
            user = await self.conn.fetchrow(
                "SELECT id, username, email FROM users WHERE id = $1",
                user_id
            )
            return dict(user) if user else None
        except Exception as e:
            logger.error(f"Failed to get user: {e}")
            return None

    async def get_organization_by_user(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Get organization information for a user."""
        try:
            org = await self.conn.fetchrow("""
                SELECT o.* FROM organizations o
                JOIN user_organizations uo ON o.id = uo.organization_id
                WHERE uo.user_id = $1
            """, user_id)
            return dict(org) if org else None
        except Exception as e:
            logger.error(f"Failed to get organization: {e}")
            return None


class PipelineRepository(BaseRepository):
    """Repository for pipeline-related database operations."""

    async def get_pipeline_assets(self, pipeline_id: int) -> List[Dict[str, Any]]:
        """Get RAG assets for a pipeline."""
        try:
            assets = await self.conn.fetch("""
                SELECT * FROM pipeline_rag_assets
                WHERE pipeline_id = $1
                ORDER BY created_at ASC
            """, pipeline_id)
            return [dict(asset) for asset in assets]
        except Exception as e:
            logger.error(f"Failed to get pipeline assets: {e}")
            return []


# Factory function to create repositories
def create_repositories(conn: asyncpg.Connection) -> Dict[str, BaseRepository]:
    """Create all repository instances."""
    return {
        'jobs': JobRepository(conn),
        'credentials': CredentialRepository(conn),
        'alerts': AlertRepository(conn),
        'users': UserRepository(conn),
        'pipelines': PipelineRepository(conn)
    }