
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
    
    if success:
        print("\nTesting get_projects...")
        try:
            projects = await jira.get_projects()
            print(f"Successfully fetched {len(projects)} projects.")
        except Exception as e:
            print(f"get_projects failed: {e}")
            
        print("\nTesting get_issues...")
        try:
            # Try with all projects first
            issues_result = await jira.get_issues(max_results=5)
            print(f"Successfully fetched issues. Total: {issues_result.get('total')}")
        except Exception as e:
            print(f"get_issues failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
