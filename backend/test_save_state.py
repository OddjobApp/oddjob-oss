
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from core.saas_connectors import connector_manager, ConnectorCredentials
from services.connectors.jira_connector import JiraConnector
from core.service_base import ServiceConfig

def test_save():
    config = ServiceConfig(name="test_jira", enabled=True, allowed_projects=["PROJ1"])
    credentials = ConnectorCredentials(username="test_user", api_key="test_key")
    connector = JiraConnector(config, credentials, "https://test.atlassian.net")
    
    print(f"Registering connector. Persistence file: {connector_manager.persistence_file}")
    connector_manager.register_connector(connector)
    
    if os.path.exists(connector_manager.persistence_file):
        print(f"✅ Success: {connector_manager.persistence_file} created.")
        with open(connector_manager.persistence_file, "r") as f:
            print("Content:")
            print(f.read())
    else:
        print(f"❌ Failure: {connector_manager.persistence_file} NOT created.")

if __name__ == "__main__":
    test_save()
