
import asyncio
import os
import sys

# Set up PYTHONPATH
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from core.saas_manager import connector_manager
from core.saas_registry import SaaSConnectorRegistry
from core.saas_types import ConnectorStatus

# Import connectors to register factories
import services.connectors.jira_connector
import services.connectors.confluence_connector

async def check_status():
    print(f"Registered factories: {list(SaaSConnectorRegistry._factories.keys())}")
    
    # Load org 1 state
    await connector_manager.load_org_state(1)
    
    confluence = connector_manager.get_connector(1, "confluence")
    if not confluence:
        print("Confluence connector NOT found for org 1 in connector_manager")
        # Check repository directly
        from core.saas_repository import ConnectorRepository
        repo = ConnectorRepository()
        connectors, _, _ = await repo.load_all_for_org(1)
        print(f"Connectors in repo for org 1: {list(connectors.keys())}")
        return

    print(f"Platform: {confluence.platform_name}")
    print(f"Status: {confluence.status}")
    print(f"Last Sync: {confluence.last_sync}")
    
    if hasattr(confluence, 'error_message'):
        print(f"Error Message: {confluence.error_message}")
    
    if confluence.status == ConnectorStatus.ERROR:
        print(f"Connector is in ERROR state. Potential permission/config issue.")
        
    print("\nSync History (last 5):")
    for event in connector_manager.sync_history[:5]:
        if event['platform'] == 'confluence':
            print(f"- {event['timestamp']}: {event['sync_type']} -> {event['status']}")

if __name__ == "__main__":
    asyncio.run(check_status())
