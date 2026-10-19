"""
SaaS Connector Manager
Manages registration, initialization, and coordination of SaaS connectors
"""

import asyncio
import os
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

from core.structured_logging import get_structured_logger
from core.saas_types import (
    ConnectorStatus,
    BidirectionalSyncConfig,
    EventDrivenWorkflow
)
from core.saas_base import SaaSConnector

logger = get_structured_logger("saas_manager")


class ConnectorManager:
    """Manager for SaaS connectors."""

    def __init__(self):
        # Scoped by org_id: {org_id: {platform: connector}}
        self.org_connectors: Dict[int, Dict[str, SaaSConnector]] = {}
        # Scoped by org_id: {org_id: {platform: config}}
        self.org_sync_configs: Dict[int, Dict[str, BidirectionalSyncConfig]] = {}
        
        self.logger = get_structured_logger("connector_manager")
        
        # Initialize Repository
        from core.saas_repository import ConnectorRepository
        self.repository = ConnectorRepository()

        # Advanced features
        self.event_workflows: Dict[str, List[EventDrivenWorkflow]] = {}
        self.sync_tasks: Dict[str, asyncio.Task] = {}

        # In-memory sync history (not persisted)
        self.sync_history: List[Dict[str, Any]] = []

    def log_sync_event(self, platform: str, sync_type: str, status: str, details: Dict[str, Any]) -> None:
        """Log a sync event to history."""
        event = {
            "id": f"sync_{int(datetime.now().timestamp() * 1000)}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "platform": platform,
            "sync_type": sync_type,
            "status": status,
            "details": details
        }
        self.sync_history.insert(0, event)
        # Keep last 50 events
        if len(self.sync_history) > 50:
            self.sync_history = self.sync_history[:50]

    async def register_connector(self, org_id: int, connector: SaaSConnector) -> None:
        """Register a SaaS connector for an organization."""
        platform = connector.platform_name.lower()
        if org_id not in self.org_connectors:
            self.org_connectors[org_id] = {}
        
        self.org_connectors[org_id][platform] = connector
        self.logger.info(f"Registered {platform} connector for org {org_id}")
        await self.repository.save_connector(org_id, connector)

    async def unregister_connector(self, org_id: int, platform: str) -> None:
        """Unregister and delete a connector."""
        if org_id in self.org_connectors and platform in self.org_connectors[org_id]:
            del self.org_connectors[org_id][platform]
            self.logger.info(f"Unregistered {platform} connector for org {org_id}")

    async def load_org_state(self, org_id: int) -> None:
        """Load connector state for an organization from the database."""
        try:
            (
                connectors, 
                bidirectional_syncs, 
                event_workflows
            ) = await self.repository.load_all_for_org(org_id)
            
            self.org_connectors[org_id] = connectors
            self.org_sync_configs[org_id] = bidirectional_syncs
            # self.event_workflows = event_workflows # Workflows still global for now?
            
            self.logger.info(f"Loaded state for org {org_id}. Connectors: {list(connectors.keys())}")
            
            # Start syncs for this org
            for platform, config in bidirectional_syncs.items():
                if config.enabled:
                    self._start_bidirectional_sync(org_id, platform)
                    
        except Exception as e:
            self.logger.error(f"Error loading state for org {org_id}: {e}")

    def get_connector(self, org_id: int, platform: str) -> Optional[SaaSConnector]:
        """Get connector by org and platform."""
        return self.org_connectors.get(org_id, {}).get(platform.lower())

    async def initialize_all(self) -> None:
        """Initialize all registered connectors for all organizations."""
        # For now, prioritize loading org 1 or we'd need a way to list all orgs
        await self.load_org_state(1)
        
        # Initialize connectors across all orgs
        for org_id, connectors in self.org_connectors.items():
            for connector in connectors.values():
                try:
                    await connector.ensure_initialized()
                except Exception as e:
                    self.logger.error(f"Failed to initialize {connector.platform_name} for org {org_id}: {e}")
                    
            # Start bidirectional syncs for this org
            sync_configs = self.org_sync_configs.get(org_id, {})
            for platform, config in sync_configs.items():
                if config.enabled:
                    self._start_bidirectional_sync(org_id, platform)

    async def sync_now(self, platform: str, sync_type: str = "projects", **kwargs) -> Dict[str, Any]:
        """Trigger an immediate sync for a platform.
        
        Args:
            platform: The platform to sync (e.g., 'jira', 'confluence')
            sync_type: Type of sync to perform (e.g., 'knowledge_store', 'projects')
            **kwargs: Additional parameters passed to the connector (e.g., organization_id)
        """
        organization_id = kwargs.get("organization_id", 1)
        connector = self.get_connector(organization_id, platform)
        if not connector:
            raise ValueError(f"Connector {platform} not found for org {organization_id}")
            
        self.logger.info(f"Triggering immediate {sync_type} sync for {platform}", extra={"kwargs": kwargs})
        result = await connector.sync_data(sync_type, **kwargs)

        self.log_sync_event(
            platform, 
            sync_type, 
            "success" if result.get("success") else "error", 
            result
        )
            
        return result

    async def shutdown_all(self) -> None:
        """Shutdown all connectors for all organizations."""
        for org_id, connectors in self.org_connectors.items():
            for connector in connectors.values():
                try:
                    await connector.shutdown()
                except Exception as e:
                    self.logger.error(f"Failed to shutdown {connector.platform_name} for org {org_id}: {e}")

    async def sync_all_connectors(self, org_id: int = 1, sync_type: str = "full") -> Dict[str, Any]:
        """Sync data from all connectors for a specific organization."""
        results = {}
        connectors = self.org_connectors.get(org_id, {})

        for platform, connector in connectors.items():
            try:
                if connector.status == ConnectorStatus.CONNECTED:
                    result = await connector.sync_data(sync_type, organization_id=org_id)
                    results[platform] = result
                else:
                    results[platform] = {
                        "success": False,
                        "error": f"Connector not connected: {connector.status.value}"
                    }
            except Exception as e:
                    results[platform] = {
                        "success": False,
                        "error": str(e)
                    }

            # Log the result
            self.log_sync_event(
                platform,
                sync_type,
                "success" if results[platform].get("success") else "error",
                results[platform]
            )

        return results

    def get_connector_status(self, org_id: int = 1) -> Dict[str, Dict[str, Any]]:
        """Get status of all connectors for an organization."""
        connectors = self.org_connectors.get(org_id, {})
        return {
            platform: {
                "status": connector.status.value,
                "last_sync": connector.last_sync.isoformat() if connector.last_sync else None,
                "platform": connector.platform_name
            }
            for platform, connector in connectors.items()
        }

    async def configure_bidirectional_sync(
        self,
        org_id: int,
        platform: str,
        sync_config: BidirectionalSyncConfig
    ) -> None:
        """Configure bidirectional synchronization for a platform."""
        connector = self.get_connector(org_id, platform)
        if not connector:
            raise ValueError(f"Connector for platform '{platform}' not found for org {org_id}")

        if org_id not in self.org_sync_configs:
            self.org_sync_configs[org_id] = {}
            
        self.org_sync_configs[org_id][platform] = sync_config
        self.logger.info(f"Configured bidirectional sync for {platform} in org {org_id}")
        await self.repository.save_sync_config(org_id, platform, sync_config)

        if sync_config.enabled:
            self._start_bidirectional_sync(org_id, platform)

    def _start_bidirectional_sync(self, org_id: int, platform: str) -> None:
        """Start bidirectional sync task for a platform."""
        task_key = f"{org_id}_{platform}"
        if task_key in self.sync_tasks:
            self.sync_tasks[task_key].cancel()

        self.sync_tasks[task_key] = asyncio.create_task(self._run_bidirectional_sync(org_id, platform))

    async def _run_bidirectional_sync(self, org_id: int, platform: str) -> None:
        """Run bidirectional sync loop for a platform."""
        try:
            while True:
                sync_config = self.org_sync_configs.get(org_id, {}).get(platform)
                if not sync_config or not sync_config.enabled:
                    break

                connector = self.get_connector(org_id, platform)
                if connector and connector.status == ConnectorStatus.CONNECTED:
                    if sync_config.should_sync(connector.last_sync):
                        await self._perform_bidirectional_sync(org_id, platform, sync_config)

                await asyncio.sleep(sync_config.sync_interval * 60) # Interval is in minutes

        except asyncio.CancelledError:
            self.logger.info(f"Bidirectional sync cancelled for {platform} (Org {org_id})")
        except Exception as e:
            self.logger.error(f"Bidirectional sync failed for {platform} (Org {org_id}): {e}")

    async def _perform_bidirectional_sync(
        self,
        org_id: int,
        platform: str,
        sync_config: BidirectionalSyncConfig
    ) -> None:
        """Perform actual bidirectional synchronization."""
        connector = self.get_connector(org_id, platform)
        if not connector:
            return

        try:
            # This is a framework - actual implementation would be platform-specific
            # For now, just perform a standard sync
            result = await connector.sync_data("bidirectional")
            self.logger.info(f"Bidirectional sync completed for {platform}: {result}")
            
            self.log_sync_event(platform, "bidirectional", "success", result)

        except Exception as e:
            self.logger.error(f"Bidirectional sync error for {platform}: {e}")
            self.log_sync_event(platform, "bidirectional", "error", {"error": str(e)})

    def add_event_workflow(self, platform: str, workflow: EventDrivenWorkflow) -> None:
        """Add an event-driven workflow for a platform."""
        if platform not in self.event_workflows:
            self.event_workflows[platform] = []

        self.event_workflows[platform].append(workflow)
        self.logger.info(f"Added event workflow for {platform}: {workflow.trigger_event}")
        self.save_state()

    async def trigger_event_workflows(
        self,
        platform: str,
        event_type: str,
        event_data: Dict[str, Any]
    ) -> List[str]:
        """Trigger event-driven workflows for a platform."""
        triggered_workflows = []

        workflows = self.event_workflows.get(platform, [])
        for workflow in workflows:
            if workflow.matches_event(event_type, event_data):
                try:
                    # Transform event data if needed
                    transformed_data = self._transform_event_data(event_data, workflow.transformation)

                    # Trigger workflow (placeholder - would integrate with agent orchestrator)
                    await self._trigger_workflow(workflow.workflow_id, transformed_data)

                    triggered_workflows.append(workflow.workflow_id)
                    self.logger.info(f"Triggered workflow {workflow.workflow_id} for {platform} event")

                except Exception as e:
                    self.logger.error(f"Failed to trigger workflow {workflow.workflow_id}: {e}")

        return triggered_workflows

    def _transform_event_data(
        self,
        event_data: Dict[str, Any],
        transformation: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Transform event data according to workflow configuration."""
        transformed = event_data.copy()

        # Apply field mappings
        mappings = transformation.get("field_mappings", {})
        for target_field, source_field in mappings.items():
            if source_field in event_data:
                transformed[target_field] = event_data[source_field]

        # Apply filters
        filters = transformation.get("filters", {})
        for field, filter_value in filters.items():
            if field in transformed and transformed[field] != filter_value:
                # Remove non-matching data
                transformed.pop(field, None)

        return transformed

    async def _trigger_workflow(self, workflow_id: str, data: Dict[str, Any]) -> None:
        """Trigger a workflow with event data."""
        # Placeholder - in real implementation, this would call agent orchestrator
        # await agent_orchestrator.start_workflow(workflow_id, data)
        self.logger.info(f"Workflow {workflow_id} triggered with data: {data}")

    def get_advanced_features_status(self, org_id: int = 1) -> Dict[str, Any]:
        """Get status of advanced integration features for an organization."""
        sync_configs = self.org_sync_configs.get(org_id, {})
        connectors = self.org_connectors.get(org_id, {})
        
        return {
            "bidirectional_syncs": {
                platform: {
                    "enabled": config.enabled,
                    "sync_interval": config.sync_interval,
                    "last_sync": connectors[platform].last_sync.isoformat()
                    if platform in connectors and connectors[platform].last_sync else None
                }
                for platform, config in sync_configs.items()
            },
            "event_workflows": {
                platform: [
                    {
                        "trigger_event": wf.trigger_event,
                        "workflow_id": wf.workflow_id,
                        "enabled": wf.enabled,
                        "conditions": wf.conditions
                    }
                    for wf in workflows
                ]
                for platform, workflows in self.event_workflows.items()
            },
            "active_sync_tasks": list(self.sync_tasks.keys())
        }

    async def get_sync_history(self) -> List[Dict[str, Any]]:
        """Get sync history."""
        return self.sync_history


# Global connector manager instance
connector_manager = ConnectorManager()
