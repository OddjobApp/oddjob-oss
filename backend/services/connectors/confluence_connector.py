"""
Confluence SaaS Connector
Integration with Confluence for documentation and knowledge management
"""

from typing import Dict, List, Any, Optional
from datetime import datetime, timezone

from core.service_base import ServiceConfig
from core.saas_connectors import (
    SaaSConnector,
    ConnectorCredentials,
    WebhookPayload,
    ConnectorStatus
)
from core.memory_store import MemoryType
from core.structured_logging import get_structured_logger
from core.api_client import api_client
from core.auth_helpers import get_auth_header

logger = get_structured_logger("confluence_connector")


class ConfluenceConnector(SaaSConnector):
    """Confluence SaaS connector for documentation and knowledge management."""

    def __init__(self, config: ServiceConfig, credentials: ConnectorCredentials, base_url: str):
        # Confluence base URL is provided by user (e.g., https://yourcompany.atlassian.net/wiki)
        super().__init__(config, "confluence", base_url, credentials)
        self.cloud_id = None
        self._diag_file = "confluence_diag.log"

    def _log_diag(self, message: str):
        """Write to a dedicated diagnostic log file."""
        try:
            with open(self._diag_file, "a") as f:
                timestamp = datetime.now(timezone.utc).isoformat()
                f.write(f"[{timestamp}] {message}\n")
        except:
            pass

    async def _resolve_cloud_id(self) -> Optional[str]:
        """Attempt to resolve the cloudId for an atlassian.net site."""
        if ".atlassian.net" not in self.base_url:
            return None
        
        # Site URL is just the domain part before /wiki
        site_url = self.base_url.split("/wiki")[0]
        try:
            import httpx
            async with httpx.AsyncClient(timeout=10) as client:
                self._log_diag(f"Attempting to resolve cloudId for: {site_url}")
                response = await client.get(f"{site_url}/_edge/tenant_info")
                if response.status_code == 200:
                    data = response.json()
                    cloud_id = data.get("cloudId")
                    self._log_diag(f"Resolved cloudId: {cloud_id}")
                    return cloud_id
                else:
                    self._log_diag(f"Failed to resolve cloudId: Status {response.status_code}")
        except Exception as e:
            self._log_diag(f"Error resolving cloudId: {e}")
        return None

    async def initialize(self) -> None:
        """Initialize Confluence connector."""
        await super().initialize()
        if not self.cloud_id:
            self.cloud_id = await self._resolve_cloud_id()
        
    async def shutdown(self) -> None:
        """Shutdown Confluence connector."""
        self.status = ConnectorStatus.DISCONNECTED
        logger.info("Confluence connector shutdown")

    async def make_request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Make authenticated request to Confluence."""
        headers = kwargs.get('headers', {}).copy()
        
        # Add auth header using shared utility
        auth_header = get_auth_header(
            username=self.credentials.username,
            api_key=self.credentials.api_key,
            access_token=self.credentials.access_token
        )
        if auth_header:
            headers['Authorization'] = auth_header
            
        headers['Content-Type'] = 'application/json'
        headers['Accept'] = 'application/json'
        # Add a more standard User-Agent to avoid blocks
        headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        kwargs['headers'] = headers
        
        # Determine URL
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        
        # If we have a cloud_id, we can try the alternative gateway if the primary fails
        # or just use it as the primary. Based on user feedback, the api.atlassian.com pattern is preferred for OAuth.
        
        try:
            import httpx
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                self._log_diag(f"Requesting: {method} {url}")
                response = await client.request(method, url, **kwargs)
                
                if response.status_code >= 400:
                    try:
                        error_detail = response.json()
                    except:
                        error_detail = response.text
                    
                    log_msg = f"Confluence request failed: {method} {endpoint} - Status {response.status_code}\nDetails: {error_detail}\nURL: {url}"
                    logger.error(log_msg)
                    self._log_diag(log_msg)
                    
                    # If 403/400/401 and we haven't tried with cloud_id gateway yet, maybe try it?
                    # But only if we have a cloud_id
                    if response.status_code in [400, 401, 403, 404] and self.cloud_id:
                        alt_url = f"https://api.atlassian.com/ex/confluence/{self.cloud_id}/{endpoint.lstrip('/')}"
                        self._log_diag(f"Retrying with alternative gateway: {alt_url}")
                        alt_response = await client.request(method, alt_url, **kwargs)
                        if alt_response.status_code < 400:
                            self._log_diag("Success with alternative gateway!")
                            return alt_response.json()
                        else:
                            self._log_diag(f"Alternative gateway also failed with status {alt_response.status_code}")
                            try:
                                alt_error = alt_response.json()
                            except:
                                alt_error = alt_response.text
                            self._log_diag(f"Alt gateway error details: {alt_error}")
                
                response.raise_for_status()
                return response.json()
        except Exception as e:
            if not isinstance(e, httpx.HTTPStatusError):
                self._log_diag(f"Confluence request exception: {e}")
                logger.error(f"Confluence request exception: {method} {endpoint} - {e}")
            raise

    async def validate_connection(self) -> tuple[bool, str]:
        """Validate Confluence connection."""
        if not self.cloud_id:
            try:
                await self.initialize()
            except Exception as e:
                self._log_diag(f"Initialization / cloudId resolution failed: {e}")

        last_error = "Unknown error"
        try:
            # Try a very basic endpoint first (list spaces)
            try:
                response = await self.make_request("GET", "/rest/api/space?limit=1")
                if "results" in response:
                    return True, "Successfully validated Confluence connection via /rest/api/space"
            except Exception as e:
                last_error = str(e)
                self._log_diag(f"Primary validation (/rest/api/space) failed: {e}")
            
            # Fallback: check current user (often works when space list is restricted)
            self._log_diag("Attempting fallback validation via /rest/api/user/current")
            try:
                response = await self.make_request("GET", "/rest/api/user/current")
                if "accountId" in response or "username" in response or "emailAddress" in response:
                    return True, "Successfully validated Confluence connection via /rest/api/user/current"
            except Exception as e:
                last_error = str(e)
                self._log_diag(f"Fallback validation (/rest/api/user/current) failed: {e}")
            
            return False, f"Confluence validation failed. Last error: {last_error}"
            
        except Exception as e:
            self._log_diag(f"All Confluence validation attempts failed: {e}")
            logger.error(f"Confluence validation failed: {e}")
            return False, f"Confluence validation failed: {str(e)}"

    async def authenticate(self) -> bool:
        """Authenticate with Confluence API."""
        if not self.credentials.api_key and not (self.credentials.username and self.credentials.password):
            self.status = ConnectorStatus.ERROR
            self._log_diag("Authentication failed: Missing credentials")
            return False

        try:
            # Test authentication by getting current user (robust endpoint)
            response = await self.make_request("GET", "/rest/api/user/current")
            if "accountId" in response or "emailAddress" in response:
                self.status = ConnectorStatus.CONNECTED
                logger.info("Authenticated successfully with Confluence")
                self._log_diag("Authenticated successfully with Confluence")
                return True
            else:
                logger.error("Confluence authentication failed: Invalid response format from /rest/api/user/current")
                self._log_diag("Confluence authentication failed: Invalid response format")
                self.status = ConnectorStatus.ERROR
                return False
        except Exception as e:
            logger.error(f"Confluence authentication exception: {e}")
            self._log_diag(f"Confluence authentication exception: {e}")
            self.status = ConnectorStatus.ERROR
            return False

    async def get_user_profile(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Get Confluence user profile."""
        endpoint = "/rest/api/user/current" if not user_id else f"/rest/api/user?accountId={user_id}"
        response = await self.make_request("GET", endpoint)

        return {
            "account_id": response.get("accountId"),
            "display_name": response.get("displayName"),
            "email_address": response.get("emailAddress"),
            "avatar_url": response.get("profilePicture", {}).get("path"),
            "timezone": response.get("timeZone"),
            "active": response.get("active", True)
        }

    async def get_spaces(self) -> List[Dict[str, Any]]:
        """Get list of spaces."""
        self._log_diag(f"DEBUG: get_spaces calling URL: {self.base_url}, User: {self.credentials.username}")
        
        allowed = getattr(self.config, 'allowed_spaces', None)
        if isinstance(allowed, str):
            allowed = [s.strip() for s in allowed.split(",")]
        
        self._log_diag(f"DEBUG: allowed_spaces from config: {allowed} (type: {type(allowed)})")

        spaces = []
        
        # If specific spaces are allowed, try fetching them directly first
        if allowed:
            for key in allowed:
                try:
                    # Fetch single space directly
                    # Note: make_request raises for 4xx/5xx so we catch here
                    space_data = await self.make_request("GET", f"/rest/api/space/{key}")
                    if space_data:
                        spaces.append({
                            "id": space_data.get("id"),
                            "key": space_data.get("key"),
                            "name": space_data.get("name"),
                            "type": space_data.get("type"),
                            "url": space_data.get("_links", {}).get("webui")
                        })
                except Exception as e:
                    self._log_diag(f"DEBUG: Failed to fetch space {key} directly: {e}")
            
            # If we found any of the allowed spaces, return them
            if spaces:
                self._log_diag(f"DEBUG: Directly found {len(spaces)} spaces: {[s['key'] for s in spaces]}")
                return spaces

        # Fallback: list global spaces with a higher limit
        response = await self.make_request("GET", "/rest/api/space?type=global&limit=100")
        results = response.get("results", [])
        self._log_diag(f"DEBUG: Raw API results count: {len(results)}")
        
        all_keys = [s.get('key') for s in results]
        self._log_diag(f"DEBUG: All found keys in first page: {all_keys}")

        return [
            {
                "id": space.get("id"),
                "key": space.get("key"),
                "name": space.get("name"),
                "type": space.get("type"),
                "url": space.get("_links", {}).get("webui")
            }
            for space in results
            if not allowed or any(a.strip().upper() == str(space.get("key")).strip().upper() for a in (allowed if isinstance(allowed, list) else [allowed]))
        ]

    async def get_pages(
        self,
        space_key: str,
        limit: int = 100,
        start_at: int = 0
    ) -> Dict[str, Any]:
        """Get pages in a space using CQL for better reliability."""
        # Using search/cql is often more reliable across different Confluence versions
        cql = f'space="{space_key}" AND type="page"'
        endpoint = f"/rest/api/search?cql={cql}&limit={limit}&start={start_at}&expand=content.body.storage,content.version,content.space"
        
        self._log_diag(f"DEBUG: get_pages endpoint: {endpoint}")
        response = await self.make_request("GET", endpoint)
        
        results = response.get("results", [])
        self._log_diag(f"DEBUG: get_pages found {len(results)} results")

        pages = []
        for result in results:
            content = result.get("content", result) # search returns content in a 'content' field
            pages.append({
                "id": content.get("id"),
                "title": content.get("title"),
                "space_key": space_key,
                "version": content.get("version", {}).get("number"),
                "url": content.get("_links", {}).get("webui"),
                "body": content.get("body", {}).get("storage", {}).get("value")
            })

        return {
            "pages": pages,
            "total": response.get("totalSize", response.get("size", len(pages))),
            "limit": limit,
            "start_at": start_at
        }

    async def _process_webhook_payload(self, payload: WebhookPayload) -> None:
        """Process Confluence webhook payload."""
        # Standard implementation for Confluence webhooks
        pass

    async def _perform_sync(
        self,
        sync_type: str,
        since: Optional[datetime],
        **kwargs
    ) -> Dict[str, Any]:
        """Perform data synchronization for Confluence."""
        if sync_type == "spaces":
            spaces = await self.get_spaces()
            return {
                "data": spaces,
                "metadata": {
                    "total_spaces": len(spaces),
                    "sync_timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
        elif sync_type == "pages":
            space_key = kwargs.get("space_key")
            if not space_key:
                raise ValueError("space_key required for page sync")
            
            pages_data = await self.get_pages(space_key, limit=kwargs.get("limit", 100))
            return {
                "data": pages_data["pages"],
                "metadata": {
                    "total_pages": pages_data["total"],
                    "sync_timestamp": datetime.now(timezone.utc).isoformat(),
                    "space_key": space_key
                }
            }
        elif sync_type == "knowledge_store":
            # Ingest pages into the Knowledge Store
            space_key = kwargs.get("space_key")
            dataset_id = kwargs.get("dataset_id")
            organization_id = kwargs.get("organization_id")

            # Auto-ensure dataset if missing
            if not dataset_id and organization_id:
                try:
                    ds_result = api_client.ensure_platform_dataset("confluence", organization_id)
                    dataset_id = ds_result.get("id")
                    logger.info(f"Auto-resolved Confluence dataset: {dataset_id}")
                except Exception as e:
                    logger.warning(f"Failed to auto-resolve Confluence dataset: {e}")
            
            limit = kwargs.get("limit", 100)
            
            # If no space_key provided, sync all allowed spaces
            found_spaces = await self.get_spaces()
            self._log_diag(f"DEBUG: found_spaces count: {len(found_spaces)}")
            spaces_to_sync = [space_key] if space_key else [s["key"] for s in found_spaces]
            self._log_diag(f"DEBUG: spaces_to_sync: {spaces_to_sync}")
            
            ingested_count = 0
            from services.memory_service import memory_service
            
            for skey in spaces_to_sync:
                pages_result = await self.get_pages(skey, limit=limit)
                pages = pages_result.get("pages", [])
                
                for page in pages:
                    # Construct the full URL for the page
                    page_url = f"{self.base_url}{page['url']}" if page.get('url') else None
                    
                    # Get full content (body.storage is already expanded in get_pages)
                    content = f"""
# Confluence Page: {page['title']}
**Space:** {page['space_key']}
**Version:** {page['version']}
**URL:** {page_url or 'N/A'}

## Content
{page.get('body', 'No content available.')}
"""
                    # Store in vector memory
                    await memory_service.memory_store.store_memory(
                        content=content,
                        memory_type=MemoryType.FACT,
                        importance=0.7,
                        tags=["confluence", page['space_key']],
                        context={
                            "platform": "confluence",
                            "page_id": page['id'],
                            "space_key": page['space_key'],
                            "external_id": page['id'],
                            "url": page_url
                        },
                        source=f"confluence_sync_{page['id']}"
                    )

                    # Ingest into persistent Knowledge Store (Node.js)
                    try:
                        api_client.ingest_knowledge_document(
                            title=f"Confluence: {page['title']}",
                            content=page.get('body', ''),
                            url=page_url,
                            metadata={
                                "platform": "confluence",
                                "page_id": page['id'],
                                "space_key": page['space_key'],
                                "external_id": page['id'],
                                "connector_name": self.config.name,
                                "sync_type": "confluence_connector"
                            },
                            topic_names=[page['space_key']],
                            dataset_id=dataset_id,
                            organization_id=organization_id
                        )
                    except Exception as e:
                        logger.error(f"Failed to ingest Confluence page {page['id']} into Knowledge Store: {e}")

                    ingested_count += 1
                    if ingested_count % 10 == 0:
                        self._log_diag(f"DEBUG: Ingested {ingested_count} pages so far...")

            # Trigger Knowledge Graph extraction batch after sync
            if ingested_count > 0 and organization_id:
                try:
                    logger.info(f"Triggering automated KG extraction for Confluence (Org: {organization_id})")
                    api_client.trigger_extraction("confluence", organization_id)
                except Exception as e:
                    logger.error(f"Failed to trigger Confluence KG extraction: {e}")
            
            return {
                "data": {"ingested_count": ingested_count},
                "metadata": {
                    "total_ingested": ingested_count,
                    "spaces_synced": spaces_to_sync,
                    "sync_timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
        else:
            raise ValueError(f"Unsupported sync type: {sync_type}")


from core.saas_registry import register_connector

# Factory function to create Confluence connector
@register_connector("confluence")
def create_confluence_connector(
    base_url: str,
    api_key: Optional[str] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
    config_overrides: Optional[Dict[str, Any]] = None
) -> ConfluenceConnector:
    """Create a Confluence connector."""
    overrides = (config_overrides or {}).copy()
    name = overrides.pop("name", "confluence_connector")
    enabled = overrides.pop("enabled", True)
    
    timeout = overrides.pop("timeout", 30)
    retry_attempts = overrides.pop("retry_attempts", 3)
    
    # Normalize base URL for Atlassian Cloud
    normalized_url = base_url.rstrip('/')
    if ".atlassian.net" in normalized_url and "/wiki" not in normalized_url:
        normalized_url = f"{normalized_url}/wiki"
        logger.info(f"Normalized Confluence base URL to: {normalized_url}")

    config = ServiceConfig(
        name=name,
        enabled=enabled,
        timeout=timeout,
        retry_attempts=retry_attempts,
        **overrides
    )

    credentials = ConnectorCredentials(
        api_key=api_key,
        username=username,
        password=password
    )

    return ConfluenceConnector(config, credentials, normalized_url)
