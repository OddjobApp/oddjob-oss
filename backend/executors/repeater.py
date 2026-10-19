import json
import asyncio
from typing import Dict, Any, Optional, Tuple
import asyncpg
from .base import BaseExecutor, ExecutorRegistry

class RepeaterExecutor(BaseExecutor):
    async def execute(self, conn: asyncpg.Connection, job_id: int, job_config: Dict[str, Any], 
                      input_data: Optional[str] = None, job_tool: Optional[str] = None) -> Tuple[bool, str]:
        try:
            from runner import resolve_item_variables
            
            input_source = job_config.get("inputSource")
            nested_job_config = job_config.get("nestedJobConfig", {})
            max_iterations = job_config.get("maxIterations")
            stop_on_error = job_config.get("stopOnError", False)
            wait_between_iterations_ms = job_config.get("waitBetweenIterationsMs", 0)
            
            json_array_str = input_data if input_data else input_source
            if not json_array_str:
                return False, "No input data provided for repeater job"
            
            try:
                items = json.loads(json_array_str)
                if not isinstance(items, list):
                    return False, "Input source must resolve to a JSON array"
            except json.JSONDecodeError as e:
                return False, f"Failed to parse input source as JSON array: {str(e)}"
            
            if max_iterations and len(items) > max_iterations:
                items = items[:max_iterations]
            
            if len(items) == 0:
                return True, json.dumps([], indent=2)
            
            results = []
            api_executor = ExecutorRegistry.get_executor("api")
            
            for i, item in enumerate(items):
                if i > 0 and wait_between_iterations_ms > 0:
                    await asyncio.sleep(wait_between_iterations_ms / 1000.0)
                
                try:
                    resolved_nested_config = {}
                    for key, value in nested_job_config.items():
                        if isinstance(value, str):
                            resolved_nested_config[key] = await resolve_item_variables(value, item, i)
                        elif isinstance(value, dict):
                            resolved_dict = {}
                            for k, v in value.items():
                                resolved_dict[k] = await resolve_item_variables(v, item, i) if isinstance(v, str) else v
                            resolved_nested_config[key] = resolved_dict
                        else:
                            resolved_nested_config[key] = value
                    
                    if api_executor:
                        success, output = await api_executor.execute(conn, job_id, resolved_nested_config)
                    else:
                        success, output = False, "API Executor not registered"
                    
                    results.append({"success": success, "output": output, "itemIndex": i})
                    if not success and stop_on_error:
                        return False, f"Repeater job stopped on error at item {i}: {output}"
                        
                except Exception as e:
                    if stop_on_error: return False, f"Repeater job stopped on error at item {i}: {str(e)}"
                    results.append({"success": False, "output": str(e), "itemIndex": i})
            
            return True, json.dumps(results, indent=2)
            
        except Exception as e:
            return False, f"Repeater job execution error: {str(e)}"
