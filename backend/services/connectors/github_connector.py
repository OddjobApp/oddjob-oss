"""
GitHub SaaS Connector
Integration with GitHub for repository monitoring and automation
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
from core.structured_logging import get_structured_logger

logger = get_structured_logger("github_connector")


class GitHubConnector(SaaSConnector):
    """GitHub SaaS connector for repository and PR monitoring."""

    def __init__(self, config: ServiceConfig, credentials: ConnectorCredentials):
        super().__init__(config, "github", "https://api.github.com", credentials)

    async def authenticate(self) -> bool:
        """Authenticate with GitHub API."""
        if not self.credentials.access_token:
            self.status = ConnectorStatus.ERROR
            return False

        try:
            # Test authentication by getting user info
            await self.make_request("GET", "/user")
            self.status = ConnectorStatus.CONNECTED
            return True
        except Exception as e:
            logger.error(f"GitHub authentication failed: {e}")
            self.status = ConnectorStatus.ERROR
            return False

    async def validate_connection(self) -> bool:
        """Validate GitHub connection."""
        try:
            response = await self.make_request("GET", "/user")
            return response.get("login") is not None
        except Exception:
            return False

    async def get_user_profile(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Get GitHub user profile."""
        endpoint = f"/users/{user_id}" if user_id else "/user"
        response = await self.make_request("GET", endpoint)

        return {
            "id": response.get("id"),
            "login": response.get("login"),
            "name": response.get("name"),
            "email": response.get("email"),
            "avatar_url": response.get("avatar_url"),
            "html_url": response.get("html_url"),
            "company": response.get("company"),
            "location": response.get("location"),
            "public_repos": response.get("public_repos"),
            "followers": response.get("followers")
        }

    async def _process_webhook_payload(self, payload: WebhookPayload) -> None:
        """Process GitHub webhook payload."""
        event_data = payload.raw_payload

        if payload.event_type.value == "push":
            payload.processed_data = {
                "ref": event_data.get("ref"),
                "before": event_data.get("before"),
                "after": event_data.get("after"),
                "commits": [
                    {
                        "id": commit.get("id"),
                        "message": commit.get("message"),
                        "author": commit.get("author", {}).get("name"),
                        "timestamp": commit.get("timestamp")
                    }
                    for commit in event_data.get("commits", [])
                ],
                "repository": {
                    "name": event_data.get("repository", {}).get("name"),
                    "full_name": event_data.get("repository", {}).get("full_name"),
                    "url": event_data.get("repository", {}).get("html_url")
                },
                "pusher": {
                    "name": event_data.get("pusher", {}).get("name"),
                    "email": event_data.get("pusher", {}).get("email")
                }
            }

        elif payload.event_type.value == "pull_request":
            pr = event_data.get("pull_request", {})
            payload.processed_data = {
                "action": event_data.get("action"),
                "number": pr.get("number"),
                "title": pr.get("title"),
                "body": pr.get("body"),
                "state": pr.get("state"),
                "merged": pr.get("merged"),
                "mergeable": pr.get("mergeable"),
                "user": {
                    "login": pr.get("user", {}).get("login"),
                    "html_url": pr.get("user", {}).get("html_url")
                },
                "head": {
                    "ref": pr.get("head", {}).get("ref"),
                    "sha": pr.get("head", {}).get("sha")
                },
                "base": {
                    "ref": pr.get("base", {}).get("ref"),
                    "sha": pr.get("base", {}).get("sha")
                },
                "repository": {
                    "name": event_data.get("repository", {}).get("name"),
                    "full_name": event_data.get("repository", {}).get("full_name")
                }
            }

        elif payload.event_type.value == "issues":
            issue = event_data.get("issue", {})
            payload.processed_data = {
                "action": event_data.get("action"),
                "number": issue.get("number"),
                "title": issue.get("title"),
                "body": issue.get("body"),
                "state": issue.get("state"),
                "labels": [
                    {"name": label.get("name"), "color": label.get("color")}
                    for label in issue.get("labels", [])
                ],
                "user": {
                    "login": issue.get("user", {}).get("login"),
                    "html_url": issue.get("user", {}).get("html_url")
                },
                "assignees": [
                    {"login": assignee.get("login"), "html_url": assignee.get("html_url")}
                    for assignee in issue.get("assignees", [])
                ],
                "repository": {
                    "name": event_data.get("repository", {}).get("name"),
                    "full_name": event_data.get("repository", {}).get("full_name")
                }
            }

    async def _perform_sync(self, sync_type: str, since: Optional[datetime], **kwargs) -> Dict[str, Any]:
        """Perform GitHub data synchronization."""
        if sync_type == "repositories":
            return await self._sync_repositories(since, **kwargs)
        elif sync_type == "issues":
            return await self._sync_issues(since, **kwargs)
        elif sync_type == "pull_requests":
            return await self._sync_pull_requests(since, **kwargs)
        elif sync_type == "commits":
            return await self._sync_commits(since, **kwargs)
        else:
            raise ValueError(f"Unsupported sync type: {sync_type}")

    async def _sync_repositories(self, since: Optional[datetime], **kwargs) -> Dict[str, Any]:
        """Sync repository data."""
        try:
            # Get authenticated user's repositories
            response = await self.make_request("GET", "/user/repos", params={
                "sort": "updated",
                "per_page": 100,
                "type": "owner"
            })

            repositories = []
            for repo in response:
                repo_data = {
                    "id": repo.get("id"),
                    "name": repo.get("name"),
                    "full_name": repo.get("full_name"),
                    "description": repo.get("description"),
                    "url": repo.get("html_url"),
                    "language": repo.get("language"),
                    "stars": repo.get("stargazers_count"),
                    "forks": repo.get("forks_count"),
                    "open_issues": repo.get("open_issues_count"),
                    "private": repo.get("private"),
                    "archived": repo.get("archived"),
                    "updated_at": repo.get("updated_at")
                }
                repositories.append(repo_data)

            return {
                "data": repositories,
                "metadata": {
                    "total_count": len(repositories),
                    "sync_type": "repositories"
                }
            }

        except Exception as e:
            logger.error(f"Repository sync failed: {e}")
            return {"data": [], "metadata": {"error": str(e)}}

    async def _sync_issues(self, since: Optional[datetime], **kwargs) -> Dict[str, Any]:
        """Sync issue data."""
        repo = kwargs.get("repository")
        if not repo:
            return {"data": [], "metadata": {"error": "Repository parameter required"}}

        try:
            params = {"state": "all", "per_page": 100}
            if since:
                params["since"] = since.isoformat()

            response = await self.make_request("GET", f"/repos/{repo}/issues", params=params)

            issues = []
            for issue in response:
                # Skip pull requests (they also appear in issues endpoint)
                if issue.get("pull_request"):
                    continue

                issue_data = {
                    "id": issue.get("id"),
                    "number": issue.get("number"),
                    "title": issue.get("title"),
                    "body": issue.get("body"),
                    "state": issue.get("state"),
                    "labels": [
                        {"name": label.get("name"), "color": label.get("color")}
                        for label in issue.get("labels", [])
                    ],
                    "created_at": issue.get("created_at"),
                    "updated_at": issue.get("updated_at"),
                    "closed_at": issue.get("closed_at"),
                    "user": {
                        "login": issue.get("user", {}).get("login"),
                        "html_url": issue.get("user", {}).get("html_url")
                    }
                }
                issues.append(issue_data)

            return {
                "data": issues,
                "metadata": {
                    "total_count": len(issues),
                    "repository": repo,
                    "sync_type": "issues"
                }
            }

        except Exception as e:
            logger.error(f"Issue sync failed: {e}")
            return {"data": [], "metadata": {"error": str(e)}}

    async def _sync_pull_requests(self, since: Optional[datetime], **kwargs) -> Dict[str, Any]:
        """Sync pull request data."""
        repo = kwargs.get("repository")
        if not repo:
            return {"data": [], "metadata": {"error": "Repository parameter required"}}

        try:
            params = {"state": "all", "per_page": 100}
            if since:
                params["since"] = since.isoformat()

            response = await self.make_request("GET", f"/repos/{repo}/pulls", params=params)

            prs = []
            for pr in response:
                pr_data = {
                    "id": pr.get("id"),
                    "number": pr.get("number"),
                    "title": pr.get("title"),
                    "body": pr.get("body"),
                    "state": pr.get("state"),
                    "merged": pr.get("merged"),
                    "mergeable": pr.get("mergeable"),
                    "created_at": pr.get("created_at"),
                    "updated_at": pr.get("updated_at"),
                    "closed_at": pr.get("closed_at"),
                    "merged_at": pr.get("merged_at"),
                    "user": {
                        "login": pr.get("user", {}).get("login"),
                        "html_url": pr.get("user", {}).get("html_url")
                    },
                    "head": {
                        "ref": pr.get("head", {}).get("ref"),
                        "sha": pr.get("head", {}).get("sha")
                    },
                    "base": {
                        "ref": pr.get("base", {}).get("ref"),
                        "sha": pr.get("base", {}).get("sha")
                    }
                }
                prs.append(pr_data)

            return {
                "data": prs,
                "metadata": {
                    "total_count": len(prs),
                    "repository": repo,
                    "sync_type": "pull_requests"
                }
            }

        except Exception as e:
            logger.error(f"Pull request sync failed: {e}")
            return {"data": [], "metadata": {"error": str(e)}}

    async def _sync_commits(self, since: Optional[datetime], **kwargs) -> Dict[str, Any]:
        """Sync commit data."""
        repo = kwargs.get("repository")
        if not repo:
            return {"data": [], "metadata": {"error": "Repository parameter required"}}

        try:
            params = {"per_page": 100}
            if since:
                params["since"] = since.isoformat()

            response = await self.make_request("GET", f"/repos/{repo}/commits", params=params)

            commits = []
            for commit in response:
                commit_info = commit.get("commit", {})
                author = commit_info.get("author", {})
                committer = commit_info.get("committer", {})

                commit_data = {
                    "sha": commit.get("sha"),
                    "message": commit_info.get("message"),
                    "author": {
                        "name": author.get("name"),
                        "email": author.get("email"),
                        "date": author.get("date")
                    },
                    "committer": {
                        "name": committer.get("name"),
                        "email": committer.get("email"),
                        "date": committer.get("date")
                    },
                    "url": commit.get("html_url"),
                    "stats": commit.get("stats", {})
                }
                commits.append(commit_data)

            return {
                "data": commits,
                "metadata": {
                    "total_count": len(commits),
                    "repository": repo,
                    "sync_type": "commits"
                }
            }

        except Exception as e:
            logger.error(f"Commit sync failed: {e}")
            return {"data": [], "metadata": {"error": str(e)}}


# Factory function to create GitHub connector
def create_github_connector(
    access_token: str,
    config_overrides: Optional[Dict[str, Any]] = None
) -> GitHubConnector:
    """
    Create a GitHub connector with personal access token authentication.
    
    Args:
        access_token: GitHub personal access token or OAuth token
        config_overrides: Optional configuration overrides (name, enabled, timeout, retry_attempts, etc.)
        
    Returns:
        Configured GitHubConnector instance
    """
    overrides = (config_overrides or {}).copy()
    name = overrides.pop("name", "github_connector")
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
        access_token=access_token
    )

    return GitHubConnector(config, credentials)