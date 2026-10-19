from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, Tuple
import asyncpg

class BaseExecutor(ABC):
    @abstractmethod
    async def execute(self, conn: asyncpg.Connection, job_id: int, job_config: Dict[str, Any], 
                      input_data: Optional[str] = None, job_tool: Optional[str] = None) -> Tuple[bool, str]:
        pass

class ExecutorRegistry:
    _executors: Dict[str, BaseExecutor] = {}

    @classmethod
    def register(cls, job_type: str, executor: BaseExecutor):
        cls._executors[job_type] = executor

    @classmethod
    def get_executor(cls, job_type: str) -> Optional[BaseExecutor]:
        return cls._executors.get(job_type)
