"""
API Client for internal service communication
Provides helpers to call Node.js API endpoints
"""

import requests
from typing import Dict, List, Any, Optional
from core.config import settings
from core.structured_logging import get_structured_logger

logger = get_structured_logger("api_client")

class NodeAPIClient:
    """Client for calling Node.js API endpoints."""

    def __init__(self):
        self.base_url = settings.NODE_API_URL
        self.timeout = 30

    def post(self, endpoint: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Perform a POST request to the Node.js API."""
        url = f"{self.base_url}{endpoint}"
        headers = {}
        if settings.INTERNAL_API_SECRET:
            headers["X-Internal-Token"] = settings.INTERNAL_API_SECRET
            
        try:
            logger.info(f"Calling Node.js API: POST {endpoint}")
            response = requests.post(url, json=data, headers=headers, timeout=self.timeout)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Node.js API call failed: {e}", extra={"url": url, "data": data})
            raise

    def ingest_knowledge_document(
        self,
        title: str,
        content: str,
        source_type: str = "text",
        url: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        topic_ids: Optional[List[int]] = None,
        topic_names: Optional[List[str]] = None,
        dataset_id: Optional[str] = None,
        organization_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Ingest a document into the Knowledge Store.
        Calls POST /api/knowledge/documents
        
        Args:
            organization_id: Organization ID to scope the document to.
                            Required for proper multi-tenancy when calling from
                            internal services (Python backend).
        """
        payload = {
            "title": title,
            "textContent": content,
            "sourceType": source_type,
            "url": url,
            "metadata": metadata or {},
            "topicIds": topic_ids or [],
            "topicNames": topic_names or [],
            "datasetId": dataset_id,
            "organizationId": organization_id
        }
        return self.post("/api/knowledge/documents", payload)

    def ensure_platform_dataset(self, platform: str, organization_id: int) -> Dict[str, Any]:
        """
        Ensure a platform-specific dataset exists.
        Calls POST /api/datasets/ensure-platform-dataset
        """
        payload = {
            "platform": platform,
            "organizationId": organization_id
        }
        return self.post("/api/datasets/ensure-platform-dataset", payload)

    def add_dataset_items(self, dataset_id: int, items: List[Dict[str, Any]], organization_id: int) -> Dict[str, Any]:
        """
        Add items to a dataset.
        Calls POST /api/datasets/:id/items
        """
        payload = {
            "items": items,
            "organizationId": organization_id
        }
        return self.post(f"/api/datasets/{dataset_id}/items", payload)

    def trigger_extraction(self, platform: str, organization_id: int) -> Dict[str, Any]:
        """
        Trigger Knowledge Graph extraction for a platform.
        Calls POST /api/saas/connectors/:platform/trigger-extraction
        """
        payload = {
            "platform": platform,
            "organization_id": organization_id
        }
        return self.post(f"/api/saas/connectors/{platform}/trigger-extraction", payload)

# Global client instance
api_client = NodeAPIClient()
