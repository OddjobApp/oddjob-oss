
import sys

def test_import(module_name):
    try:
        print(f"Importing {module_name}...")
        __import__(module_name)
        print(f"✅ {module_name} imported")
    except Exception as e:
        print(f"❌ {module_name} failed: {e}")

modules = [
    "services.connectors.jira_connector",
    "services.connectors.slack_connector",
    "services.connectors.teams_connector",
    "services.connectors.confluence_connector"
]

for m in modules:
    test_import(m)

print("All connector imports tested.")
