from .base import ExecutorRegistry
from .ai import AIExecutor
from .api import APIExecutor
from .shell import ShellExecutor
from .python import PythonScriptExecutor
from .repeater import RepeaterExecutor
from .atlassian import AtlassianSyncExecutor

def initialize_executors():
    registry = ExecutorRegistry()
    registry.register("ai_api_call", AIExecutor())
    registry.register("api", APIExecutor())
    registry.register("curl", APIExecutor())
    registry.register("shell", ShellExecutor())
    registry.register("python", PythonScriptExecutor())
    registry.register("repeater", RepeaterExecutor())
    registry.register("jira_sync", AtlassianSyncExecutor("jira"))
    registry.register("confluence_sync", AtlassianSyncExecutor("confluence"))
    return registry
