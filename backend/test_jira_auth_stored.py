
import asyncio
import os
import sys
from dotenv import load_dotenv

# Ensure the current directory is in path
sys.path.append(os.getcwd())

from core.saas_manager import connector_manager
from core.saas_registry import SaaSConnectorRegistry
import services.connectors.jira_connector

async def main():
    load_dotenv()
    
    org_id = 1
    await connector_manager.load_org_state(org_id)
    
    connectors = connector_manager.org_connectors.get(org_id, {})
    if "jira" not in connectors:
        print("Jira connector not found in memory.")
        return
        
    jira = connectors["jira"]
    print(f"Testing Jira connector for {jira.base_url}...")
    
    # Try to authenticate
    success = await jira.authenticate()
    print(f"Authentication success: {success}")
    print(f"Connector status: {jira.status}")

if __name__ == "__main__":
    asyncio.run(main())
