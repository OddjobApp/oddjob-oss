
import asyncio
import os
import json
from dotenv import load_dotenv

# Import the necessary components
import sys
# Ensure the current directory is in path
sys.path.append(os.getcwd())

from core.saas_manager import connector_manager
from core.saas_registry import SaaSConnectorRegistry

# Trigger registration
import services.connectors.jira_connector
import services.connectors.slack_connector

async def main():
    load_dotenv()
    
    print("Registered factories:", list(SaaSConnectorRegistry._factories.keys()))
    
    org_id = 1
    print(f"\nLoading state for org {org_id}...")
    await connector_manager.load_org_state(org_id)
    
    connectors = connector_manager.org_connectors.get(org_id, {})
    print(f"In-memory connectors for org {org_id}: {list(connectors.keys())}")
    
    if "jira" in connectors:
        jira = connectors["jira"]
        print(f"Jira connector found! Status: {jira.status}, Base URL: {getattr(jira, 'base_url', 'N/A')}")
    else:
        print("Jira connector NOT found in memory after load.")

if __name__ == "__main__":
    asyncio.run(main())
