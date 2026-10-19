"""
SaaS API Models
Pydantic models for SaaS API requests and responses
"""

from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class ConnectorConfigRequest(BaseModel):
    """Request model for creating/updating a connector."""
    platform: str = Field(..., description="SaaS platform name (slack, github, jira, teams)")
    config: Dict[str, Any] = Field(..., description="Service configuration")
    credentials: Dict[str, Any] = Field(..., description="Authentication credentials")
    oauth_config: Optional[Dict[str, Any]] = Field(None, description="OAuth configuration for OAuth connectors")
    organization_id: Optional[int] = Field(None, description="Organization ID for multi-tenant isolation")


class ConnectorResponse(BaseModel):
    """Response model for connector information."""
    platform: str
    status: str
    last_sync: Optional[datetime]
    config_name: str
    is_enabled: bool
    base_url: Optional[str] = None
    username: Optional[str] = None
    allowed_projects: Optional[List[str]] = None
    error_message: Optional[str] = None


class SyncRequest(BaseModel):
    """Request model for data synchronization."""
    sync_type: str = Field(..., description="Type of data to sync")
    since: Optional[datetime] = Field(None, description="Sync data since this timestamp")
    parameters: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Additional sync parameters")


class SyncResponse(BaseModel):
    """Response model for sync operations."""
    platform: str
    sync_type: str
    success: bool
    items_synced: int = 0
    error: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class WebhookTestRequest(BaseModel):
    """Request model for webhook testing."""
    event_type: str = Field(..., description="Webhook event type")
    payload: Dict[str, Any] = Field(..., description="Webhook payload to test")


class BidirectionalSyncConfigRequest(BaseModel):
    """Request model for bidirectional sync configuration."""
    enabled: bool = Field(True, description="Enable bidirectional sync")
    sync_interval: int = Field(300, description="Sync interval in seconds")
    conflict_resolution: str = Field("last_write_wins", description="Conflict resolution strategy")
    mappings: Optional[Dict[str, Dict[str, Any]]] = Field(None, description="Field mappings")
    organization_id: Optional[int] = Field(None, description="Organization ID for multi-tenant isolation")
    filters: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Sync filters")


class EventWorkflowRequest(BaseModel):
    """Request model for event-driven workflow."""
    trigger_event: str = Field(..., description="Event type to trigger on")
    workflow_id: str = Field(..., description="Workflow ID to trigger")
    conditions: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Event conditions")
    transformation: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Data transformation rules")
    enabled: bool = Field(True, description="Enable the workflow")


class TestConnectionRequest(BaseModel):
    """Request model for testing connection."""
    platform: str
    base_url: Optional[str] = None
    api_token: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    tenant_id: Optional[str] = None
    bot_token: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    config: Optional[Dict[str, Any]] = Field(default_factory=dict)


class JiraCommentRequest(BaseModel):
    """Request model for adding a Jira comment."""
    issue_key: str = Field(..., description="Jira issue key")
    comment: str = Field(..., description="Comment text")
    organization_id: Optional[int] = Field(None, description="Organization ID")


class JiraTransitionRequest(BaseModel):
    """Request model for transitioning a Jira issue."""
    issue_key: str = Field(..., description="Jira issue key")
    status: str = Field(..., description="Target status or transition name")
    organization_id: Optional[int] = Field(None, description="Organization ID")


class JiraUpdateRequest(BaseModel):
    """Request model for updating a Jira issue."""
    issue_key: str = Field(..., description="Jira issue key")
    summary: Optional[str] = Field(None, description="New summary")
    description: Optional[str] = Field(None, description="New description")
    priority: Optional[str] = Field(None, description="New priority")
    assignee: Optional[str] = Field(None, description="New assignee ID")
    labels: Optional[List[str]] = Field(None, description="New labels")
    organization_id: Optional[int] = Field(None, description="Organization ID")


class JiraCreateRequest(BaseModel):
    """Request model for creating a Jira issue."""
    project_key: str = Field(..., description="Jira project key")
    summary: str = Field(..., description="Issue summary")
    issue_type: str = Field(..., description="Issue type (e.g., Bug, Task)")
    description: Optional[str] = Field(None, description="Issue description")
    assignee: Optional[str] = Field(None, description="Assignee account ID")
    priority: Optional[str] = Field(None, description="Priority name")
    labels: Optional[List[str]] = Field(None, description="List of labels")
    organization_id: Optional[int] = Field(None, description="Organization ID")
