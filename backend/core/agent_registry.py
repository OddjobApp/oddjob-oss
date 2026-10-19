"""
Agent Registry and Dynamic Selection
Manages agent capabilities, performance metrics, and intelligent agent routing
"""

import asyncio
import json
import math
from typing import Dict, List, Any, Optional, Callable, Set, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from enum import Enum

from .structured_logging import get_structured_logger
from .agent_communication import AgentMessage, MessageType, MessagePriority, AgentCapability
from .redis_client import get_redis_client
from .error_patterns import ErrorHandler, ErrorContext

logger = get_structured_logger("agent_registry")


class AgentRole(Enum):
    """Roles agents can fulfill in the orchestration system."""
    COORDINATOR = "coordinator"      # Manages multi-agent workflows
    EXECUTOR = "executor"           # Executes specific tasks
    ANALYZER = "analyzer"           # Analyzes data and provides insights
    SPECIALIST = "specialist"       # Domain-specific expertise
    SUPERVISOR = "supervisor"       # Oversees and validates work
    INTEGRATOR = "integrator"       # Handles external integrations


class AgentStatus(Enum):
    """Current status of an agent."""
    AVAILABLE = "available"
    BUSY = "busy"
    OFFLINE = "offline"
    ERROR = "error"
    MAINTENANCE = "maintenance"


@dataclass
class AgentProfile:
    """Complete profile of an agent including capabilities and performance."""
    agent_id: str
    name: str
    description: str
    version: str
    roles: List[AgentRole] = field(default_factory=list)
    capabilities: List[AgentCapability] = field(default_factory=list)

    # Status and health
    status: AgentStatus = AgentStatus.OFFLINE
    last_seen: Optional[datetime] = None
    health_score: float = 1.0  # 0.0 to 1.0

    # Performance metrics
    total_tasks_executed: int = 0
    successful_tasks: int = 0
    average_response_time: float = 0.0
    error_rate: float = 0.0

    # Resource constraints
    max_concurrent_tasks: int = 1
    current_active_tasks: int = 0

    # Metadata
    tags: List[str] = field(default_factory=list)
    custom_metadata: Dict[str, Any] = field(default_factory=dict)

    def update_performance(self, success: bool, response_time: float) -> None:
        """Update performance metrics after task completion."""
        self.total_tasks_executed += 1
        if success:
            self.successful_tasks += 1

        # Update rolling average response time
        if self.total_tasks_executed == 1:
            self.average_response_time = response_time
        else:
            # Weighted average favoring recent performance
            weight = min(0.1, 1.0 / self.total_tasks_executed)
            self.average_response_time = (
                self.average_response_time * (1 - weight) +
                response_time * weight
            )

        self.error_rate = 1.0 - (self.successful_tasks / self.total_tasks_executed)

    def calculate_overall_score(self) -> float:
        """Calculate overall agent score based on multiple factors."""
        if self.status != AgentStatus.AVAILABLE:
            return 0.0

        # Base factors
        health_factor = self.health_score
        success_factor = (self.successful_tasks / max(1, self.total_tasks_executed))
        availability_factor = 1.0 if self.current_active_tasks < self.max_concurrent_tasks else 0.0

        # Performance factor (lower response time is better)
        performance_factor = max(0.1, 1.0 / (1.0 + self.average_response_time))

        # Combine factors with weights
        overall_score = (
            health_factor * 0.3 +
            success_factor * 0.3 +
            availability_factor * 0.2 +
            performance_factor * 0.2
        )

        return min(1.0, max(0.0, overall_score))

    def can_handle_task(self, task_requirements: Dict[str, Any]) -> Tuple[bool, float]:
        """
        Check if agent can handle a task and return confidence score.

        Returns:
            Tuple of (can_handle, confidence_score)
        """
        required_capabilities = task_requirements.get("required_capabilities", [])
        preferred_capabilities = task_requirements.get("preferred_capabilities", [])
        max_response_time = task_requirements.get("max_response_time")
        priority = task_requirements.get("priority", MessagePriority.NORMAL)

        # Check basic availability
        if self.status != AgentStatus.AVAILABLE:
            return False, 0.0

        if self.current_active_tasks >= self.max_concurrent_tasks:
            return False, 0.0

        # Check response time constraint
        if max_response_time and self.average_response_time > max_response_time:
            return False, 0.0

        # Check required capabilities
        capability_score = self._calculate_capability_match(required_capabilities, preferred_capabilities)

        # Penalize for high error rate
        reliability_penalty = 1.0 - (self.error_rate * 2.0)  # Double penalty for errors

        # Boost for priority handling capability
        priority_boost = 1.0
        if priority.value >= MessagePriority.HIGH.value:
            # Check if agent has good performance with high-priority tasks
            priority_boost = min(1.5, 1.0 + (self.health_score * 0.5))

        confidence = capability_score * reliability_penalty * priority_boost
        confidence = min(1.0, max(0.0, confidence))

        return capability_score >= 0.3, confidence  # Minimum capability threshold

    def _calculate_capability_match(
        self,
        required: List[str],
        preferred: List[str]
    ) -> float:
        """Calculate how well agent capabilities match requirements."""
        if not required and not preferred:
            return 1.0  # No requirements = perfect match

        # Check required capabilities (must have all)
        required_matched = 0
        for req_cap in required:
            if any(self._has_capability(req_cap, cap) for cap in self.capabilities):
                required_matched += 1

        if required and required_matched < len(required):
            return 0.0  # Missing required capabilities

        # Check preferred capabilities (bonus points)
        preferred_matched = 0
        for pref_cap in preferred:
            if any(self._has_capability(pref_cap, cap) for cap in self.capabilities):
                preferred_matched += 1

        # Calculate score
        required_score = 1.0 if not required else (required_matched / len(required))
        preferred_score = preferred_matched / max(1, len(preferred)) if preferred else 0.5

        return (required_score * 0.7) + (preferred_score * 0.3)

    def _has_capability(self, requirement: str, capability: AgentCapability) -> bool:
        """Check if agent has a specific capability."""
        return (
            capability.name.lower() == requirement.lower() or
            requirement.lower() in capability.description.lower() or
            requirement.lower() in [tag.lower() for tag in capability.tags] if hasattr(capability, 'tags') else False
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        data = asdict(self)
        data["roles"] = [role.value for role in self.roles]
        data["status"] = self.status.value
        data["capabilities"] = [cap.__dict__ if hasattr(cap, '__dict__') else asdict(cap) for cap in self.capabilities]
        if self.last_seen:
            data["last_seen"] = self.last_seen.isoformat()
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AgentProfile':
        """Create from dictionary."""
        # Convert enums back
        data["roles"] = [AgentRole(role) for role in data.get("roles", [])]
        data["status"] = AgentStatus(data.get("status", "offline"))
        data["capabilities"] = [AgentCapability(**cap) for cap in data.get("capabilities", [])]

        # Convert timestamp
        if "last_seen" in data and data["last_seen"]:
            data["last_seen"] = datetime.fromisoformat(data["last_seen"])

        return cls(**data)


class AgentSelector:
    """Intelligent agent selection based on task requirements and agent capabilities."""

    def __init__(self, registry: 'AgentRegistry'):
        self.registry = registry
        self.logger = get_structured_logger("agent_selector")

    async def select_best_agent(
        self,
        task_requirements: Dict[str, Any],
        exclude_agents: Optional[List[str]] = None
    ) -> Optional[AgentProfile]:
        """
        Select the best agent for a given task.

        Args:
            task_requirements: Task requirements and constraints
            exclude_agents: List of agent IDs to exclude

        Returns:
            Best matching agent or None if no suitable agent found
        """
        exclude_agents = exclude_agents or []
        candidates = []

        # Find all agents that can handle the task
        for agent_id, agent in self.registry.agents.items():
            if agent_id in exclude_agents:
                continue

            can_handle, confidence = agent.can_handle_task(task_requirements)
            if can_handle:
                candidates.append((agent, confidence))

        if not candidates:
            self.logger.warning("No suitable agents found for task", extra={"requirements": task_requirements})
            return None

        # Sort by confidence score (highest first)
        candidates.sort(key=lambda x: x[1], reverse=True)

        best_agent, confidence = candidates[0]
        self.logger.info(
            f"Selected agent {best_agent.agent_id} with confidence {confidence:.2f}",
            extra={
                "agent_id": best_agent.agent_id,
                "confidence": confidence,
                "candidates_count": len(candidates),
                "requirements": task_requirements
            }
        )

        return best_agent

    async def select_agents_for_collaboration(
        self,
        task_requirements: Dict[str, Any],
        max_agents: int = 3
    ) -> List[AgentProfile]:
        """
        Select multiple agents for collaborative task completion.

        Args:
            task_requirements: Task requirements
            max_agents: Maximum number of agents to select

        Returns:
            List of selected agents for collaboration
        """
        selected_agents = []
        excluded_agents = []

        # First, select a coordinator agent
        coordinator_reqs = task_requirements.copy()
        coordinator_reqs["preferred_capabilities"] = ["coordination", "orchestration"]

        coordinator = await self.select_best_agent(coordinator_reqs, excluded_agents)
        if coordinator:
            selected_agents.append(coordinator)
            excluded_agents.append(coordinator.agent_id)

        # Then select executor agents
        for _ in range(max_agents - len(selected_agents)):
            executor = await self.select_best_agent(task_requirements, excluded_agents)
            if executor:
                selected_agents.append(executor)
                excluded_agents.append(executor.agent_id)
            else:
                break

        self.logger.info(
            f"Selected {len(selected_agents)} agents for collaboration",
            extra={
                "selected_agents": [a.agent_id for a in selected_agents],
                "task_requirements": task_requirements
            }
        )

        return selected_agents

    async def get_agent_recommendations(
        self,
        task_requirements: Dict[str, Any],
        limit: int = 5
    ) -> List[Tuple[AgentProfile, float]]:
        """
        Get ranked recommendations of agents for a task.

        Returns:
            List of (agent, confidence_score) tuples, sorted by confidence
        """
        recommendations = []

        for agent in self.registry.agents.values():
            can_handle, confidence = agent.can_handle_task(task_requirements)
            if can_handle:
                recommendations.append((agent, confidence))

        # Sort by confidence score
        recommendations.sort(key=lambda x: x[1], reverse=True)

        return recommendations[:limit]


class AgentRegistry:
    """Central registry for managing agent profiles and capabilities."""

    def __init__(self):
        self.agents: Dict[str, AgentProfile] = {}
        self.selector = AgentSelector(self)
        self.logger = get_structured_logger("agent_registry")
        self._sync_task: Optional[asyncio.Task] = None

    def _get_redis_client(self):
        """Get Redis client with lazy initialization."""
        from core.redis_client import get_redis_client
        try:
            return get_redis_client()
        except ValueError:
            # Redis not configured
            self.logger.warning("Redis not configured, agent registry will not persist data")
            return None

    async def start(self) -> None:
        """Start the agent registry."""
        await self._load_agents_from_storage()
        self._sync_task = asyncio.create_task(self._periodic_sync())

    async def stop(self) -> None:
        """Stop the agent registry."""
        if self._sync_task:
            self._sync_task.cancel()
            try:
                await self._sync_task
            except asyncio.CancelledError:
                pass

    async def register_agent(
        self,
        agent_id: str,
        name: str,
        description: str,
        version: str,
        roles: List[AgentRole],
        capabilities: List[AgentCapability],
        **kwargs
    ) -> AgentProfile:
        """Register a new agent or update existing one."""
        agent = AgentProfile(
            agent_id=agent_id,
            name=name,
            description=description,
            version=version,
            roles=roles,
            capabilities=capabilities,
            status=AgentStatus.AVAILABLE,
            last_seen=datetime.now(timezone.utc),
            **kwargs
        )

        self.agents[agent_id] = agent
        redis_client = self._get_redis_client()
        if redis_client:
            await self._save_agent_to_storage(agent, redis_client)

        self.logger.info(
            f"Registered agent: {agent_id}",
            extra={
                "agent_id": agent_id,
                "name": name,
                "roles": [r.value for r in roles],
                "capabilities_count": len(capabilities)
            }
        )

        return agent

    async def update_agent_status(
        self,
        agent_id: str,
        status: AgentStatus,
        health_score: Optional[float] = None
    ) -> bool:
        """Update agent status."""
        if agent_id not in self.agents:
            return False

        agent = self.agents[agent_id]
        agent.status = status
        agent.last_seen = datetime.now(timezone.utc)

        if health_score is not None:
            agent.health_score = health_score

        redis_client = self._get_redis_client()
        if redis_client:
            await self._save_agent_to_storage(agent, redis_client)

        self.logger.info(
            f"Updated agent status: {agent_id} -> {status.value}",
            extra={"agent_id": agent_id, "status": status.value, "health_score": health_score}
        )

        return True

    async def update_agent_performance(
        self,
        agent_id: str,
        success: bool,
        response_time: float
    ) -> bool:
        """Update agent performance metrics."""
        if agent_id not in self.agents:
            return False

        agent = self.agents[agent_id]
        agent.update_performance(success, response_time)
        redis_client = self._get_redis_client()
        if redis_client:
            await self._save_agent_to_storage(agent, redis_client)

        return True

    async def get_agent(self, agent_id: str) -> Optional[AgentProfile]:
        """Get agent by ID."""
        return self.agents.get(agent_id)

    async def list_agents(
        self,
        status_filter: Optional[List[AgentStatus]] = None,
        role_filter: Optional[List[AgentRole]] = None,
        capability_filter: Optional[List[str]] = None
    ) -> List[AgentProfile]:
        """List agents with optional filters."""
        agents = list(self.agents.values())

        if status_filter:
            agents = [a for a in agents if a.status in status_filter]

        if role_filter:
            agents = [a for a in agents if any(role in a.roles for role in role_filter)]

        if capability_filter:
            agents = [
                a for a in agents
                if any(cap.name in capability_filter for cap in a.capabilities)
            ]

        return agents

    async def select_agent_for_task(
        self,
        task_requirements: Dict[str, Any],
        exclude_agents: Optional[List[str]] = None
    ) -> Optional[AgentProfile]:
        """Select the best agent for a task."""
        return await self.selector.select_best_agent(task_requirements, exclude_agents)

    async def select_agents_for_collaboration(
        self,
        task_requirements: Dict[str, Any],
        max_agents: int = 3
    ) -> List[AgentProfile]:
        """Select agents for collaborative task completion."""
        return await self.selector.select_agents_for_collaboration(task_requirements, max_agents)

    def get_agent_stats(self) -> Dict[str, Any]:
        """Get registry statistics."""
        total_agents = len(self.agents)
        available_agents = sum(1 for a in self.agents.values() if a.status == AgentStatus.AVAILABLE)
        busy_agents = sum(1 for a in self.agents.values() if a.status == AgentStatus.BUSY)

        role_counts = {}
        for agent in self.agents.values():
            for role in agent.roles:
                role_counts[role.value] = role_counts.get(role.value, 0) + 1

        return {
            "total_agents": total_agents,
            "available_agents": available_agents,
            "busy_agents": busy_agents,
            "offline_agents": total_agents - available_agents - busy_agents,
            "role_distribution": role_counts,
            "average_health_score": sum(a.health_score for a in self.agents.values()) / max(1, total_agents)
        }

    async def _save_agent_to_storage(self, agent: AgentProfile, redis_client) -> None:
        """Save agent to persistent storage."""
        try:
            agent_data = agent.to_dict()
            await redis_client.setex(
                f"agent:{agent.agent_id}",
                3600,  # 1 hour TTL
                json.dumps(agent_data)
            )
        except Exception as e:
            self.logger.error(f"Failed to save agent {agent.agent_id}: {e}")

    async def _load_agents_from_storage(self) -> None:
        """Load agents from persistent storage."""
        redis_client = self._get_redis_client()
        if not redis_client:
            return

        try:
            # Get all agent keys
            agent_keys = await redis_client.keys("agent:*")

            for key in agent_keys:
                try:
                    agent_data = await redis_client.get(key)
                    if agent_data:
                        agent_dict = json.loads(agent_data)
                        agent = AgentProfile.from_dict(agent_dict)
                        self.agents[agent.agent_id] = agent
                except Exception as e:
                    self.logger.warning(f"Failed to load agent from key {key}: {e}")

            self.logger.info(f"Loaded {len(self.agents)} agents from storage")

        except Exception as e:
            self.logger.error(f"Failed to load agents from storage: {e}")

    async def _periodic_sync(self) -> None:
        """Periodic synchronization of agent states."""
        while True:
            try:
                # Check for offline agents (not seen in last 5 minutes)
                cutoff_time = datetime.now(timezone.utc) - timedelta(minutes=5)

                offline_count = 0
                for agent in self.agents.values():
                    if (agent.status == AgentStatus.AVAILABLE and
                        agent.last_seen and agent.last_seen < cutoff_time):
                        agent.status = AgentStatus.OFFLINE
                        offline_count += 1

                if offline_count > 0:
                    self.logger.info(f"Marked {offline_count} agents as offline")

                # Sync to storage every 5 minutes
                await asyncio.sleep(300)

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Error in periodic sync: {e}")
                await asyncio.sleep(60)  # Retry after 1 minute


# Global agent registry instance
agent_registry = AgentRegistry()