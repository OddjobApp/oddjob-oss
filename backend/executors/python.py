import subprocess
import sys
import os
import tempfile
from typing import Dict, Any, Optional, Tuple
import asyncpg
from .base import BaseExecutor

class PythonScriptExecutor(BaseExecutor):
    async def execute(self, conn: asyncpg.Connection, job_id: int, job_config: Dict[str, Any], 
                      input_data: Optional[str] = None, job_tool: Optional[str] = None) -> Tuple[bool, str]:
        try:
            script_content = job_config.get("scriptContent")
            if not script_content:
                return False, "No script content provided"
            
            with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
                f.write(script_content)
                script_path = f.name
            
            try:
                result = subprocess.run(
                    [sys.executable, script_path],
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                
                if result.returncode != 0:
                    error_msg = result.stderr if result.stderr else "Script execution failed"
                    return False, error_msg
                
                output = result.stdout.strip()
                return True, output
                
            finally:
                if os.path.exists(script_path):
                    os.unlink(script_path)
                    
        except subprocess.TimeoutExpired:
            return False, "Script timed out after 5 minutes"
        except Exception as e:
            return False, str(e)
