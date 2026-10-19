import subprocess
from typing import Dict, Any, Optional, Tuple
import asyncpg
from .base import BaseExecutor

class ShellExecutor(BaseExecutor):
    async def execute(self, conn: asyncpg.Connection, job_id: int, job_config: Dict[str, Any], 
                      input_data: Optional[str] = None, job_tool: Optional[str] = None) -> Tuple[bool, str]:
        try:
            executable = job_config.get("executable")
            parameters = job_config.get("parameters", "")
            working_directory = job_config.get("workingDirectory")
            
            cmd = [executable]
            if parameters:
                cmd.extend(parameters.split())
            
            result = subprocess.run(
                cmd,
                cwd=working_directory,
                capture_output=True,
                text=True,
                # Increase timeout to 10 minutes for long-running shell scripts
                timeout=600  
            )
            
            output = result.stdout + result.stderr
            return result.returncode == 0, output
            
        except subprocess.TimeoutExpired:
            return False, "Command timed out after 10 minutes"
        except Exception as e:
            return False, str(e)
