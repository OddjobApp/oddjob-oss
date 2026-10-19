"""
Jira SaaS Connector
Integration with Jira for issue tracking and project management
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

logger = get_structured_logger("jira_connector")


class JiraConnector(SaaSConnector):
    """Jira SaaS connector for issue tracking and project management."""

    def __init__(self, config: ServiceConfig, credentials: ConnectorCredentials, base_url: str):
        # Jira base URL is provided by user (e.g., https://yourcompany.atlassian.net)
        super().__init__(config, "jira", base_url, credentials)

    async def initialize(self) -> None:
        """Initialize Jira connector."""
        # Optional: Perform any custom initialization here
        await super().initialize()
        
    async def shutdown(self) -> None:
        """Shutdown Jira connector."""
        # Cleanup resources if needed
        self.status = ConnectorStatus.DISCONNECTED
        logger.info("Jira connector shutdown")

    async def make_request(
        self,
        method: str,
        endpoint: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Make authenticated request to Jira."""
        headers = kwargs.get('headers', {})
        
        # Add auth header using shared utility
        auth_header = get_auth_header(
            username=self.credentials.username,
            api_key=self.credentials.api_key,
            access_token=self.credentials.access_token
        )
        if auth_header:
            headers['Authorization'] = auth_header
            
        kwargs['headers'] = headers
        
        try:
            import httpx
            url = f"{self.base_url}/{endpoint.lstrip('/')}"
            
            async with httpx.AsyncClient() as client:
                response = await client.request(method, url, **kwargs)
                
                if response.status_code >= 400:
                    try:
                        error_detail = response.json()
                    except:
                        error_detail = response.text
                    logger.error(f"Jira request failed: {method} {endpoint} - Status {response.status_code}")
                    logger.error(f"Jira error details: {error_detail}")
                
                response.raise_for_status()
                return response.json()
        except Exception as e:
            if not isinstance(e, httpx.HTTPStatusError):
                logger.error(f"Jira request exception: {method} {endpoint} - {e}")
            raise

    async def authenticate(self) -> bool:
        """Authenticate with Jira API."""
        if not self.credentials.api_key and not (self.credentials.username and self.credentials.password):
            self.status = ConnectorStatus.ERROR
            return False

        try:
            # Test authentication by getting current user
            response = await self.make_request("GET", "/rest/api/3/myself")
            if response.get("accountId"):
                self.status = ConnectorStatus.CONNECTED
                logger.info(f"Authenticated with Jira as: {response.get('displayName')}")
                return True
            else:
                logger.error("Jira authentication failed: Invalid response")
                self.status = ConnectorStatus.ERROR
                return False
        except Exception as e:
            logger.error(f"Jira authentication failed: {e}")
            self.status = ConnectorStatus.ERROR
            return False

    async def validate_connection(self) -> tuple[bool, str]:
        """Validate Jira connection."""
        try:
            response = await self.make_request("GET", "/rest/api/3/myself")
            if response.get("accountId"):
                return True, "Successfully validated Jira connection"
            return False, "Jira validation failed: Empty accountId in response"
        except Exception as e:
            logger.error(f"Jira validation failed: {e}")
            return False, f"Jira validation failed: {str(e)}"

    async def get_user_profile(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Get Jira user profile."""
        if user_id:
            endpoint = f"/rest/api/3/user?accountId={user_id}"
        else:
            endpoint = "/rest/api/3/myself"

        response = await self.make_request("GET", endpoint)

        return {
            "account_id": response.get("accountId"),
            "account_type": response.get("accountType"),
            "display_name": response.get("displayName"),
            "email_address": response.get("emailAddress"),
            "avatar_url": response.get("avatarUrls", {}).get("48x48"),
            "locale": response.get("locale"),
            "timezone": response.get("timeZone"),
            "active": response.get("active", True)
        }

    async def get_projects(self) -> List[Dict[str, Any]]:
        """Get list of projects."""
        response = await self.make_request("GET", "/rest/api/3/project")

        allowed = getattr(self.config, 'allowed_projects', None)
        if isinstance(allowed, str):
            allowed = [p.strip() for p in allowed.split(",")]

        return [
            {
                "id": project.get("id"),
                "key": project.get("key"),
                "name": project.get("name"),
                "description": project.get("description"),
                "project_type": project.get("projectTypeKey"),
                "style": project.get("style"),
                "is_private": project.get("isPrivate", False),
                "url": project.get("self")
            }
            for project in response
            if not allowed or project.get("key") in allowed
        ]

    async def get_issues(
        self,
        jql: Optional[str] = None,
        project_key: Optional[str] = None,
        max_results: int = 50,
        start_at: int = 0,
        **kwargs
    ) -> Dict[str, Any]:
        """Get issues with optional JQL filtering."""
        allowed = getattr(self.config, 'allowed_projects', None)
        if isinstance(allowed, str):
            allowed = [p.strip() for p in allowed.split(",")]

        # Apply project scope to JQL
        if allowed:
            # Build the quoted list separately: before Python 3.12 an f-string
            # expression part cannot contain a backslash, so the quoting cannot
            # be nested inside the outer f-string.
            quoted_projects = ", ".join('"{}"'.format(p) for p in allowed)
            scope_jql = f"project IN ({quoted_projects})"
            if jql:
                jql = f"({jql}) AND {scope_jql}"
            elif project_key:
                if project_key in allowed:
                    jql = f"project = \"{project_key}\""
                else:
                    # Requesting project outside of scope - force empty result by invalidating JQL
                    jql = f"project = \"{project_key}\" AND {scope_jql}"
            else:
                jql = scope_jql
        elif project_key:
            jql = f"project = \"{project_key}\""

        # New /search/jql pagination uses nextPageToken instead of startAt
        # But for backward compatibility or simple cases, we can try to request fields explicitly
        fields_param = "summary,description,status,priority,issuetype,project,assignee,reporter,created,updated,duedate,labels,components"
        params = f"/rest/api/3/search/jql?maxResults={max_results}&fields={fields_param}"
        
        # Add nextPageToken if provided in kwargs
        next_page_token = kwargs.get("next_page_token")
        if next_page_token:
            params += f"&nextPageToken={next_page_token}"
            
        if jql:
            # URL encode JQL if it's not already
            import urllib.parse
            params += f"&jql={urllib.parse.quote(jql)}"

        response = await self.make_request("GET", params)

        issues = []
        # Support both old 'issues' list and new 'issueDetails' in SearchAndReconcileResults
        raw_issues = response.get("issues") or response.get("issueDetails", [])
        
        for issue in raw_issues:
            fields = issue.get("fields", {})
            issue_data = {
                "id": issue.get("id"),
                "key": issue.get("key"),
                "summary": fields.get("summary"),
                "description": fields.get("description"),
                "status": fields.get("status", {}).get("name"),
                "status_category": fields.get("status", {}).get("statusCategory", {}).get("name"),
                "priority": fields.get("priority", {}).get("name") if fields.get("priority") else None,
                "issuetype": fields.get("issuetype", {}).get("name"),
                "project": fields.get("project", {}).get("name"),
                "project_key": fields.get("project", {}).get("key"),
                "assignee": fields.get("assignee", {}).get("displayName") if fields.get("assignee") else None,
                "reporter": fields.get("reporter", {}).get("displayName") if fields.get("reporter") else None,
                "created": fields.get("created"),
                "updated": fields.get("updated"),
                "duedate": fields.get("duedate"),
                "labels": fields.get("labels", []),
                "components": [c.get("name") for c in fields.get("components", [])],
                "all_fields": fields # Include raw fields for custom mapping
            }
            
            # Flatten custom fields into top-level for easier mapping
            for k, v in fields.items():
                if k.startswith("customfield_"):
                    issue_data[k] = v
                    
            issues.append(issue_data)

        return {
            "issues": issues,
            "total": response.get("total", 0),
            "max_results": response.get("maxResults", 0),
            "next_page_token": response.get("nextPageToken")
        }

    async def create_issue(
        self,
        project_key: str,
        summary: str,
        issue_type: str,
        description: Optional[str] = None,
        assignee: Optional[str] = None,
        priority: Optional[str] = None,
        labels: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Create a new Jira issue."""
        data = {
            "fields": {
                "project": {"key": project_key},
                "summary": summary,
                "issuetype": {"name": issue_type},
                "description": {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [
                                {
                                    "type": "text",
                                    "text": description or ""
                                }
                            ]
                        }
                    ]
                } if description else None
            }
        }

        if assignee:
            data["fields"]["assignee"] = {"accountId": assignee}
        if priority:
            data["fields"]["priority"] = {"name": priority}
        if labels:
            data["fields"]["labels"] = labels

        # Remove None values
        if not description:
            del data["fields"]["description"]

        response = await self.make_request("POST", "/rest/api/3/issue", json=data)

        return {
            "id": response.get("id"),
            "key": response.get("key"),
            "self": response.get("self")
        }

    async def update_issue(
        self,
        issue_key: str,
        summary: Optional[str] = None,
        description: Optional[str] = None,
        status: Optional[str] = None,
        assignee: Optional[str] = None,
        priority: Optional[str] = None,
        labels: Optional[List[str]] = None
    ) -> bool:
        """Update an existing Jira issue."""
        data = {"fields": {}}

        if summary:
            data["fields"]["summary"] = summary
        if description:
            data["fields"]["description"] = {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "type": "text",
                                "text": description
                            }
                        ]
                    }
                ]
            }
        if assignee:
            data["fields"]["assignee"] = {"accountId": assignee}
        if priority:
            data["fields"]["priority"] = {"name": priority}
        if labels is not None:
            data["fields"]["labels"] = labels

        if not data["fields"]:
            return False

        await self.make_request("PUT", f"/rest/api/3/issue/{issue_key}", json=data)

        if status:
            # Transition issue to new status
            await self.transition_issue(issue_key, status)

        return True

    async def transition_issue(self, issue_key: str, status_name: str) -> bool:
        """Transition issue to a new status."""
        # First get available transitions
        response = await self.make_request("GET", f"/rest/api/3/issue/{issue_key}/transitions")
        transitions = response.get("transitions", [])

        # Find the transition ID for the desired status
        transition_id = None
        for transition in transitions:
            if transition.get("name") == status_name or transition.get("to", {}).get("name") == status_name:
                transition_id = transition.get("id")
                break

        if not transition_id:
            logger.warning(f"No transition found for status: {status_name}")
            return False

        # Perform the transition
        data = {"transition": {"id": transition_id}}
        await self.make_request("POST", f"/rest/api/3/issue/{issue_key}/transitions", json=data)

        return True

    async def add_comment(self, issue_key: str, comment: str) -> Dict[str, Any]:
        """Add a comment to an issue."""
        data = {
            "body": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "type": "text",
                                "text": comment
                            }
                        ]
                    }
                ]
            }
        }

        response = await self.make_request("POST", f"/rest/api/3/issue/{issue_key}/comment", json=data)

        return {
            "id": response.get("id"),
            "body": response.get("body"),
            "author": response.get("author", {}).get("displayName"),
            "created": response.get("created")
        }

    async def get_issue_schema(self, project_key: str) -> List[Dict[str, Any]]:
        """Get issue field schema for a project."""
        # Use the createmeta endpoint to get fields
        # Note: In Jira Cloud API v3, /rest/api/3/issue/createmeta is deprecated or restricted.
        # Often, we use /rest/api/3/issue/createmeta?projectKeys=PROJ&expand=projects.issuetypes.fields
        # Or more modern: /rest/api/3/project/{projectKey}/statuses
        # For fields, /rest/api/3/field is global, but project specific ones are in createmeta.
        
        try:
            # Try to get fields via createmeta
            endpoint = f"/rest/api/3/issue/createmeta?projectKeys={project_key}&expand=projects.issuetypes.fields"
            response = await self.make_request("GET", endpoint)
            
            projects = response.get("projects", [])
            if not projects:
                # Fallback to global fields if project-specific discovery fails
                logger.warning(f"No project-specific schema found for {project_key}, falling back to global fields")
                return await self.get_global_fields()
                
            project = projects[0]
            issue_types = project.get("issuetypes", [])
            
            # Combine fields from all issue types or just pick the first one
            fields_map = {}
            for it in issue_types:
                it_fields = it.get("fields", {})
                for field_key, field_info in it_fields.items():
                    if field_key not in fields_map:
                        fields_map[field_key] = {
                            "key": field_key,
                            "name": field_info.get("name"),
                            "required": field_info.get("required", False),
                            "type": field_info.get("schema", {}).get("type", "any"),
                            "is_custom": field_key.startswith("customfield_"),
                            "allowed_values": field_info.get("allowedValues")
                        }
            
            return list(fields_map.values())
            
        except Exception as e:
            logger.error(f"Failed to fetch Jira schema for {project_key}: {e}")
            # Final fallback to global fields
            return await self.get_global_fields()

    async def get_global_fields(self) -> List[Dict[str, Any]]:
        """Get all available Jira fields globally."""
        response = await self.make_request("GET", "/rest/api/3/field")
        return [
            {
                "key": field.get("id"),
                "name": field.get("name"),
                "required": False, # Global list doesn't show requirement per project
                "type": field.get("schema", {}).get("type", "any"),
                "is_custom": field.get("id", "").startswith("customfield_")
            }
            for field in response
        ]

    async def get_workflows(self, project_key: str) -> List[Dict[str, Any]]:
        """Get workflows for a project."""
        response = await self.make_request("GET", f"/rest/api/3/workflow/search?projectKey={project_key}")

        return [
            {
                "id": workflow.get("id"),
                "name": workflow.get("name"),
                "description": workflow.get("description"),
                "isDefault": workflow.get("isDefault", False)
            }
            for workflow in response.get("values", [])
        ]

    async def _process_webhook_payload(self, payload: WebhookPayload) -> None:
        """Process Jira webhook payload."""
        event_data = payload.raw_payload

        if payload.event_type.value == "issue":
            issue = event_data.get("issue", {})
            fields = issue.get("fields", {})

            payload.processed_data = {
                "issue_key": issue.get("key"),
                "issue_id": issue.get("id"),
                "summary": fields.get("summary"),
                "description": fields.get("description"),
                "status": fields.get("status", {}).get("name"),
                "priority": fields.get("priority", {}).get("name"),
                "issuetype": fields.get("issuetype", {}).get("name"),
                "project": fields.get("project", {}).get("name"),
                "project_key": fields.get("project", {}).get("key"),
                "assignee": fields.get("assignee", {}).get("displayName") if fields.get("assignee") else None,
                "reporter": fields.get("reporter", {}).get("displayName") if fields.get("reporter") else None,
                "created": fields.get("created"),
                "updated": fields.get("updated"),
                "labels": fields.get("labels", []),
                "event_type": event_data.get("webhookEvent"),
                "changelog": event_data.get("changelog", {}),
                "all_fields": fields # Include raw fields for custom mapping
            }
            
            # Flatten custom fields into top-level for easier mapping
            for k, v in fields.items():
                if k.startswith("customfield_"):
                    payload.processed_data[k] = v

    async def _perform_sync(
        self,
        sync_type: str,
        since: Optional[datetime],
        **kwargs
    ) -> Dict[str, Any]:
        """Perform data synchronization for Jira."""
        if sync_type == "bidirectional":
            # Map bidirectional to knowledge_store for background sync
            sync_type = "knowledge_store"

        if sync_type == "projects":
            projects = await self.get_projects()
            return {
                "data": projects,
                "metadata": {
                    "total_projects": len(projects),
                    "sync_timestamp": datetime.now(timezone.utc).isoformat()
                }
            }

        elif sync_type == "issues":
            project_key = kwargs.get("project_key")
            jql = kwargs.get("jql")

            if since:
                # Create JQL to filter by updated date
                updated_filter = f"updated >= '{since.strftime('%Y-%m-%d %H:%M')}'"
                if jql:
                    jql = f"({jql}) AND {updated_filter}"
                else:
                    jql = updated_filter

            issues_data = await self.get_issues(
                jql=jql,
                project_key=project_key,
                max_results=kwargs.get("max_results", 100)
            )

            return {
                "data": issues_data["issues"],
                "metadata": {
                    "total_issues": issues_data["total"],
                    "fetched_issues": len(issues_data["issues"]),
                    "project_key": project_key,
                    "jql": jql,
                    "sync_timestamp": datetime.now(timezone.utc).isoformat(),
                    "since": since.isoformat() if since else None
                }
            }

        elif sync_type == "workflows":
            project_key = kwargs.get("project_key")
            if not project_key:
                raise ValueError("project_key required for workflow sync")

            workflows = await self.get_workflows(project_key)
            return {
                "data": workflows,
                "metadata": {
                    "project_key": project_key,
                    "total_workflows": len(workflows),
                    "sync_timestamp": datetime.now(timezone.utc).isoformat()
                }
            }

        elif sync_type == "knowledge_store":
            # Ingest issues into the Knowledge Store
            project_key = kwargs.get("project_key")
            dataset_id = kwargs.get("dataset_id")
            organization_id = kwargs.get("organization_id")

            # Auto-ensure dataset if missing
            if not dataset_id and organization_id:
                try:
                    ds_result = api_client.ensure_platform_dataset("jira", organization_id)
                    dataset_id = ds_result.get("id")
                    logger.info(f"Auto-resolved Jira dataset: {dataset_id}")
                except Exception as e:
                    logger.warning(f"Failed to auto-resolve Jira dataset: {e}")
            
            limit = kwargs.get("limit", 100)
            
            jql = None
            if since:
                jql = f"updated >= '{since.strftime('%Y-%m-%d %H:%M')}'"

            issues_result = await self.get_issues(
                project_key=project_key,
                max_results=limit,
                jql=jql
            )
            
            issues = issues_result.get("issues", [])
            ingested_count = 0
            
            from services.memory_service import memory_service
            
            target_storage = getattr(self.config, 'target_storage', 'knowledge_store')
            logger.info(f"Syncing Jira issues to {target_storage}")

            for issue in issues:
                content = f"""
# Jira Issue: {issue['key']}
**Summary:** {issue['summary']}
**Status:** {issue['status']}
**Priority:** {issue['priority']}
**Assignee:** {issue['assignee']}
**Reporter:** {issue['reporter']}
**Project:** {issue['project']} ({issue['project_key']})
**Created:** {issue['created']}
**Updated:** {issue['updated']}

## Description
{issue['description'] or 'No description provided.'}

## Labels
{', '.join(issue['labels']) if issue['labels'] else 'None'}
"""
                # Store in vector memory (Always do this)
                await memory_service.memory_store.store_memory(
                    content=content,
                    memory_type=MemoryType.FACT,
                    importance=0.8,
                    tags=["jira", issue['project_key'], issue['issuetype']],
                    context={
                        "platform": "jira",
                        "issue_key": issue['key'],
                        "project_key": issue['project_key'],
                        "status": issue['status'],
                        "external_id": issue['id'],
                        "url": f"{self.base_url}/browse/{issue['key']}"
                    },
                    source=f"jira_sync_{issue['key']}"
                )

                if target_storage == "dataset" and dataset_id:
                    # Ingest into structured Dataset (Node.js)
                    try:
                        api_client.add_dataset_items(
                            dataset_id=dataset_id,
                            items=[{"data": issue}],
                            organization_id=organization_id
                        )
                    except Exception as e:
                        logger.error(f"Failed to ingest Jira issue {issue['key']} into Dataset: {e}")
                else:
                    # Ingest into persistent Knowledge Store (Node.js)
                    try:
                        api_client.ingest_knowledge_document(
                            title=f"Jira: {issue['key']} - {issue['summary']}",
                            content=content,
                            url=f"{self.base_url}/browse/{issue['key']}",
                            metadata={
                                "platform": "jira",
                                "issue_key": issue['key'],
                                "project_key": issue['project_key'],
                                "status": issue['status'],
                                "external_id": issue['id'],
                                "sync_type": "jira_connector"
                            },
                            topic_names=[issue['project_key'], issue.get('issuetype', 'Issue')],
                            dataset_id=dataset_id,
                            organization_id=organization_id
                        )
                    except Exception as e:
                        logger.error(f"Failed to ingest Jira issue {issue['key']} into Knowledge Store: {e}")

                ingested_count += 1
                
            return {
                "data": {"ingested_count": ingested_count},
                "metadata": {
                    "total_found": issues_result.get("total", 0),
                    "total_ingested": ingested_count,
                    "project_key": project_key,
                    "sync_timestamp": datetime.now(timezone.utc).isoformat()
                }
            }

        else:
            raise ValueError(f"Unsupported sync type: {sync_type}")


from core.saas_registry import register_connector

# Factory function to create Jira connector
@register_connector("jira")
def create_jira_connector(
    base_url: str,
    api_key: Optional[str] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
    config_overrides: Optional[Dict[str, Any]] = None
) -> JiraConnector:
    """Create a Jira connector with API key or basic authentication."""
    overrides = (config_overrides or {}).copy()
    name = overrides.pop("name", "jira_connector")
    enabled = overrides.pop("enabled", True)
    
    timeout = overrides.pop("timeout", 30)
    retry_attempts = overrides.pop("retry_attempts", 3)
    
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

    return JiraConnector(config, credentials, base_url)