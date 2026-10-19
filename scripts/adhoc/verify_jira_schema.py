import requests
import json
import os

BASE_URL = "http://127.0.0.1:8001/api/saas"

def test_schema_discovery():
    print("Testing Jira schema discovery...")
    # First, let's see if we can get a connector for org 1, platform jira
    # This assumes a connector exists for org 1 in the test environment
    # If not, this might return 404, but we can check the error message
    
    try:
        response = requests.get(f"{BASE_URL}/connectors/jira/schema?organization_id=1")
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"Successfully fetched fields: {len(data.get('fields', []))} found.")
            if len(data.get('fields', [])) > 0:
                print(f"First field: {data['fields'][0]['name']} ({data['fields'][0]['key']})")
        else:
            print(f"Error: {response.text}")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    test_schema_discovery()
