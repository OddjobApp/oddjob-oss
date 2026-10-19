"""
Agent Communication Protocol
Standardized messaging system for multi-agent collaboration and orchestration
"""

import asyncio
import json
import uuid
from typing import Dict, Any, List, Optional, Callable, Union, Awaitable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from core.structured_logging import get_structured_logger
from core.error_patterns import ErrorHandler, ErrorContext

logger = get_structured_logger("agent_communication")


class MessageType(Enum):
    """Types of inter-agent messages."""
    TASK_REQUEST = "task_request"
    TASK_RESPONSE = "task_response"
    STATUS_UPDATE = "status_update"
    COLLABORATION_REQUEST = "collaboration_request"
    COLLABORATION_RESPONSE = "collaboration_response"
    RESOURCE_REQUEST = "resource_request"
    RESOURCE_RESPONSE = "resource_response"
    ERROR_NOTIFICATION = "error_notification"
    HEARTBEAT = "heartbeat"


class MessagePriority(Enum):
    """Message priority levels."""
    LOW = 0
    NORMAL = 1
    HIGH = 2
    CRITICAL = 3


@dataclass
class AgentMessage:
    """Standardized inter-agent message format."""
    message_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    message_type: MessageType = MessageType.TASK_REQUEST
    priority: MessagePriority = MessagePriority.NORMAL
    sender_agent_id: str = ""
    target_agent_id: Optional[str] = None  # None for broadcast
    correlation_id: Optional[str] = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Message payload
    payload: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    # Delivery and routing
    ttl_seconds: int = 300  # 5 minutes default
    requires_response: bool = False
    response_timeout: int = 30

    # Processing status
    delivered_at: Optional[datetime] = None
    processed_at: Optional[datetime] = None
    response_message_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        data = {
            "message_id": self.message_id,
            "message_type": self.message_type.value,
            "priority": self.priority.value,
            "sender_agent_id": self.sender_agent_id,
            "target_agent_id": self.target_agent_id,
            "correlation_id": self.correlation_id,
            "timestamp": self.timestamp.isoformat(),
            "payload": self.payload,
            "metadata": self.metadata,
            "ttl_seconds": self.ttl_seconds,
            "requires_response": self.requires_response,
            "response_timeout": self.response_timeout,
        }
        if self.delivered_at:
            data["delivered_at"] = self.delivered_at.isoformat()
        if self.processed_at:
            data["processed_at"] = self.processed_at.isoformat()
        if self.response_message_id:
            data["response_message_id"] = self.response_message_id
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AgentMessage':
        """Create from dictionary."""
        # Convert string enums back
        data["message_type"] = MessageType(data["message_type"])
        data["priority"] = MessagePriority(data["priority"])

        # Convert timestamps
        data["timestamp"] = datetime.fromisoformat(data["timestamp"])
        if "delivered_at" in data and data["delivered_at"]:
            data["delivered_at"] = datetime.fromisoformat(data["delivered_at"])
        if "processed_at" in data and data["processed_at"]:
            data["processed_at"] = datetime.fromisoformat(data["processed_at"])

        return cls(**data)


@dataclass
class AgentCapability:
    """Represents a specific capability an agent can provide."""
    name: str
    description: str
    input_schema: Dict[str, Any]
    output_schema: Dict[str, Any]
    performance_score: float = 1.0  # 0.0 to 1.0
    cost_per_execution: float = 0.0
    max_concurrent_tasks: int = 1
    supported_message_types: List[MessageType] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)


class AgentCommunicationBus:
    """Central communication bus for agent-to-agent messaging."""

    def __init__(self):
        self.message_handlers: Dict[str, List[Callable]] = {}
        self.running = False
        self._listener_task: Optional[asyncio.Task] = None
        self.logger = logger

    def _get_redis_client(self):
        """Get Redis client with lazy initialization."""
        from core.redis_client import get_redis_client
        try:
            return get_redis_client()
        except ValueError:
            # Redis not configured, return None or mock client
            self.logger.warning("Redis not configured, agent communication will not work")
            return None

    async def start(self) -> None:
        """Start the communication bus."""
        if self.running:
            return

        self.running = True
        # Initialize Redis client
        self._get_redis_client()
        self._listener_task = asyncio.create_task(self._message_listener())
        self.logger.info("Agent communication bus started")

    async def stop(self) -> None:
        """Stop the communication bus."""
        if not self.running:
            return

        self.running = False
        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass
        self.logger.info("Agent communication bus stopped")

    async def send_message(
        self,
        message: AgentMessage,
        await_response: bool = False,
        response_timeout: Optional[int] = None
    ) -> Optional[AgentMessage]:
        """
        Send a message to an agent or broadcast to all agents.

        Args:
            message: The message to send
            await_response: Whether to wait for a response
            response_timeout: Timeout for response in seconds

        Returns:
            Response message if await_response is True, None otherwise
        """
        try:
            # Serialize message
            message_data = message.to_dict()
            message_json = json.dumps(message_data)

            # Determine channel
            if message.target_agent_id:
                # Direct message
                channel = f"agent:{message.target_agent_id}"
            else:
                # Broadcast to all agents
                channel = "agent:broadcast"

            # Publish message
            redis_client = self._get_redis_client()
            if not redis_client:
                self.logger.warning(f"Cannot send message: Redis not available")
                return None

            await redis_client.publish(channel, message_json)

                # Store message for tracking (optional)
            await self._store_message(message, redis_client)

            self.logger.info(
                f"Sent {message.message_type.value} message",
                extra={
                    "message_id": message.message_id,
                    "sender": message.sender_agent_id,
                    "target": message.target_agent_id or "broadcast",
                    "priority": message.priority.value
                }
            )

            # Wait for response if requested
            if await_response and message.requires_response:
                return await self._wait_for_response(
                    message.message_id,
                    response_timeout or message.response_timeout
                )

            return None

        except Exception as e:
            self.logger.error(
                f"Failed to send message {message.message_id}: {e}",
                extra={"message_id": message.message_id}
            )
            raise

    async def register_handler(
        self,
        agent_id: str,
        message_types: List[MessageType],
        handler: Callable[[AgentMessage], Awaitable[None]]
    ) -> None:
        """Register a message handler for an agent."""
        for message_type in message_types:
            key = f"{agent_id}:{message_type.value}"
            if key not in self.message_handlers:
                self.message_handlers[key] = []
            self.message_handlers[key].append(handler)

        self.logger.info(
            f"Registered handler for agent {agent_id}",
            extra={"agent_id": agent_id, "message_types": [mt.value for mt in message_types]}
        )

    async def unregister_handler(
        self,
        agent_id: str,
        message_types: List[MessageType],
        handler: Optional[Callable] = None
    ) -> None:
        """Unregister a message handler."""
        for message_type in message_types:
            key = f"{agent_id}:{message_type.value}"
            if key in self.message_handlers:
                if handler:
                    self.message_handlers[key] = [
                        h for h in self.message_handlers[key] if h != handler
                    ]
                else:
                    self.message_handlers[key].clear()

        self.logger.info(f"Unregistered handlers for agent {agent_id}")

    async def _message_listener(self) -> None:
        """Listen for incoming messages."""
        redis_client = self._get_redis_client()
        if not redis_client:
            self.logger.error("Cannot start message listener: Redis not available")
            return

        pubsub = redis_client.pubsub()
        await pubsub.subscribe("agent:broadcast")

        try:
            while self.running:
                if not redis_client:
                    break
                message = await pubsub.get_message(ignore_subscribe_messages=True)
                if message:
                    await self._process_message(message["data"])
                await asyncio.sleep(0.01)  # Small delay to prevent busy waiting

        except asyncio.CancelledError:
            pass
        except Exception as e:
            self.logger.error(f"Message listener error: {e}")
        finally:
            await pubsub.unsubscribe()
            await pubsub.aclose()

    async def _process_message(self, message_data: bytes) -> None:
        """Process an incoming message."""
        try:
            message_dict = json.loads(message_data.decode('utf-8'))
            message = AgentMessage.from_dict(message_dict)

            # Mark as delivered
            message.delivered_at = datetime.now(timezone.utc)

            # Find and call handlers
            await self._dispatch_message(message)

        except Exception as e:
            self.logger.error(f"Failed to process message: {e}")

    async def _dispatch_message(self, message: AgentMessage) -> None:
        """Dispatch message to appropriate handlers."""
        # Try specific agent handler first
        if message.target_agent_id:
            key = f"{message.target_agent_id}:{message.message_type.value}"
            handlers = self.message_handlers.get(key, [])
        else:
            # Broadcast message - find all agents that can handle this type
            handlers = []
            for handler_key, handler_list in self.message_handlers.items():
                agent_id, msg_type = handler_key.split(":", 1)
                if msg_type == message.message_type.value:
                    handlers.extend(handler_list)

        # Call all matching handlers
        for handler in handlers:
            try:
                await handler(message)
            except Exception as e:
                self.logger.error(
                    f"Handler error for message {message.message_id}: {e}",
                    extra={"message_id": message.message_id}
                )

        # Mark as processed
        message.processed_at = datetime.now(timezone.utc)

    async def _wait_for_response(
        self,
        original_message_id: str,
        timeout: int
    ) -> Optional[AgentMessage]:
        """Wait for a response to a message."""
        # This would need a more sophisticated implementation
        # For now, return None (responses would be handled via callbacks)
        return None

    async def _store_message(self, message: AgentMessage, redis_client) -> None:
        """Store message for tracking and debugging."""
        # Optional: Store in Redis or database for debugging
        # For now, just log high-priority messages
        if message.priority.value >= MessagePriority.HIGH.value:
            await redis_client.setex(
                f"message:{message.message_id}",
                message.ttl_seconds,
                json.dumps(message.to_dict())
            )


# Global communication bus instance
communication_bus = AgentCommunicationBus()


# Convenience functions
async def send_agent_message(
    message_type: MessageType,
    sender_agent_id: str,
    payload: Dict[str, Any],
    target_agent_id: Optional[str] = None,
    priority: MessagePriority = MessagePriority.NORMAL,
    requires_response: bool = False,
    **kwargs
) -> Optional[AgentMessage]:
    """Convenience function to send an agent message."""
    message = AgentMessage(
        message_type=message_type,
        sender_agent_id=sender_agent_id,
        target_agent_id=target_agent_id,
        priority=priority,
        payload=payload,
        requires_response=requires_response,
        **kwargs
    )

    return await communication_bus.send_message(message, await_response=requires_response)


def create_task_request(
    sender_agent_id: str,
    task_description: str,
    task_parameters: Dict[str, Any],
    target_agent_id: Optional[str] = None,
    priority: MessagePriority = MessagePriority.NORMAL
) -> AgentMessage:
    """Create a task request message."""
    return AgentMessage(
        message_type=MessageType.TASK_REQUEST,
        sender_agent_id=sender_agent_id,
        target_agent_id=target_agent_id,
        priority=priority,
        payload={
            "task_description": task_description,
            "task_parameters": task_parameters
        },
        requires_response=True
    )


def create_task_response(
    sender_agent_id: str,
    original_message_id: str,
    result: Any,
    success: bool = True,
    error_message: Optional[str] = None
) -> AgentMessage:
    """Create a task response message."""
    return AgentMessage(
        message_type=MessageType.TASK_RESPONSE,
        sender_agent_id=sender_agent_id,
        correlation_id=original_message_id,
        payload={
            "result": result,
            "success": success,
            "error_message": error_message
        }
    )


def create_status_update(
    sender_agent_id: str,
    status: str,
    details: Optional[Dict[str, Any]] = None
) -> AgentMessage:
    """Create a status update message."""
    return AgentMessage(
        message_type=MessageType.STATUS_UPDATE,
        sender_agent_id=sender_agent_id,
        payload={
            "status": status,
            "details": details or {}
        }
    )