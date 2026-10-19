import json
import os
from typing import Dict, List, Any, Tuple, Optional
from dataclasses import asdict
from datetime import datetime

from core.structured_logging import get_structured_logger
from core.service_base import ServiceConfig
from core.database import get_pool

# Core definitions - import from split modules
from core.saas_types import (
    ConnectorCredentials, 
    BidirectionalSyncConfig, 
    EventDrivenWorkflow
)
from core.saas_base import SaaSConnector
from core.saas_registry import SaaSConnectorRegistry

logger = get_structured_logger("saas_repository")

class ConnectorRepository:
    """
    Handles persistence for SaaS connectors and configurations using Postgres.
    """
    
    def __init__(self, persistence_file: Optional[str] = None):
        # We keep the file path for backward compatibility/migration if needed
        self.persistence_file = persistence_file

    async def save_connector(self, org_id: int, connector: SaaSConnector) -> None:
        """Save or update a single connector for an organization."""
        pool = await get_pool()
        async with pool.acquire() as conn:
            config_json = json.dumps(vars(connector.config), default=str)
            creds_json = json.dumps(asdict(connector.credentials) if connector.credentials else {}, default=str)
            
            await conn.execute("""
                INSERT INTO saas_connectors (org_id, platform, base_url, status, config, credentials, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (org_id, platform) 
                DO UPDATE SET 
                    base_url = EXCLUDED.base_url,
                    status = EXCLUDED.status,
                    config = EXCLUDED.config,
                    credentials = EXCLUDED.credentials,
                    updated_at = NOW()
            """, org_id, connector.platform_name, getattr(connector, 'base_url', None), 
               "connected", config_json, creds_json)

    async def save_sync_config(self, org_id: int, platform: str, config: BidirectionalSyncConfig) -> None:
        """Save bidirectional sync configuration."""
        pool = await get_pool()
        async with pool.acquire() as conn:
            # First find the connector ID
            connector_id = await conn.fetchval(
                "SELECT id FROM saas_connectors WHERE org_id = $1 AND platform = $2",
                org_id, platform
            )
            
            if not connector_id:
                logger.error(f"Cannot save sync config: Connector for {platform} not found for org {org_id}")
                return

            mappings_json = json.dumps(config.mappings, default=str)
            # filters are not yet in the dataclass but we preserve them from UI if possible
            filters_json = json.dumps(getattr(config, 'filters', {}), default=str)

            await conn.execute("""
                INSERT INTO saas_sync_configs (connector_id, enabled, sync_interval, conflict_resolution, mappings, filters, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (connector_id)
                DO UPDATE SET
                    enabled = EXCLUDED.enabled,
                    sync_interval = EXCLUDED.sync_interval,
                    conflict_resolution = EXCLUDED.conflict_resolution,
                    mappings = EXCLUDED.mappings,
                    filters = EXCLUDED.filters,
                    updated_at = NOW()
            """, connector_id, config.enabled, config.sync_interval, 
               config.conflict_resolution, mappings_json, filters_json)

    async def load_all_for_org(self, org_id: int) -> Tuple[
        Dict[str, SaaSConnector], 
        Dict[str, BidirectionalSyncConfig], 
        Dict[str, List[EventDrivenWorkflow]]
    ]:
        """Load all connectors and configs for a specific organization."""
        connectors: Dict[str, SaaSConnector] = {}
        bidirectional_syncs: Dict[str, BidirectionalSyncConfig] = {}
        event_workflows: Dict[str, List[EventDrivenWorkflow]] = {}
        
        try:
            pool = await get_pool()
            async with pool.acquire() as conn:
                # Load connectors
                rows = await conn.fetch("""
                    SELECT platform, base_url, config, credentials 
                    FROM saas_connectors WHERE org_id = $1
                """, org_id)
                
                for row in rows:
                    platform = row['platform']
                    base_url = row['base_url']
                    
                    config_data = row['config']
                    if isinstance(config_data, str):
                        config_data = json.loads(config_data)
                        
                    creds_data = row['credentials']
                    if isinstance(creds_data, str):
                        creds_data = json.loads(creds_data)
                    
                    connector = self._restore_connector(platform, base_url, config_data, creds_data)
                    if connector:
                        connectors[platform] = connector

                # Load sync configs
                sync_rows = await conn.fetch("""
                    SELECT c.platform, s.enabled, s.sync_interval, s.conflict_resolution, s.mappings, s.filters
                    FROM saas_sync_configs s
                    JOIN saas_connectors c ON s.connector_id = c.id
                    WHERE c.org_id = $1
                """, org_id)
                
                for row in sync_rows:
                    platform = row['platform']
                    
                    mappings = row['mappings']
                    if isinstance(mappings, str):
                        mappings = json.loads(mappings)
                        
                    filters = row['filters']
                    if isinstance(filters, str):
                        filters = json.loads(filters)

                    sync_config = BidirectionalSyncConfig(
                        enabled=row['enabled'],
                        sync_interval=row['sync_interval'],
                        conflict_resolution=row['conflict_resolution'],
                        mappings=mappings
                    )
                    # Add filters if they exist
                    sync_config.filters = filters
                    bidirectional_syncs[platform] = sync_config
                    
        except Exception as e:
            logger.error(f"Failed to load state for org {org_id}: {e}")
            
        return connectors, bidirectional_syncs, event_workflows

    def _restore_connector(self, platform: str, base_url: Optional[str], config_data: Dict, creds_data: Dict) -> Optional[SaaSConnector]:
        """Internal helper to instantiate a connector object from DB data."""
        try:
            # Fallback for base_url if column is null
            if not base_url:
                base_url = creds_data.get("base_url") or config_data.get("base_url")

            factory = SaaSConnectorRegistry.get_factory(platform)
            if not factory:
                return None
                
            connector = None
            if platform == "jira" or platform == "confluence":
                connector = factory(
                    base_url,
                    creds_data.get("api_key"),
                    creds_data.get("username"),
                    creds_data.get("password"),
                    config_data
                )
            elif platform == "slack":
                connector = factory(
                    creds_data.get("access_token") or creds_data.get("bot_token"),
                    config_data
                )
            # Add other platforms as needed...
            
            if connector and hasattr(connector, 'credentials'):
                for k, v in creds_data.items():
                    if hasattr(connector.credentials, k):
                        setattr(connector.credentials, k, v)
            return connector
        except Exception as e:
            logger.error(f"Error restoring {platform} connector: {e}")
            return None

    # Keeping legacy methods as no-ops or raising for now to find call sites
    def save_state(self, *args, **kwargs):
        logger.warning("Legacy save_state called - use save_connector or save_sync_config")

    def load_state(self):
        logger.warning("Legacy load_state called - returning empty state. Use load_all_for_org")
        return {}, {}, {}
