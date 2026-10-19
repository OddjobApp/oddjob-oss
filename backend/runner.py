"""
Runner Service

Background service that executes individual jobs from the work queue.
This service processes job execution requests and runs them.
"""

import asyncio
import os
import sys
import subprocess
import json
from datetime import datetime
from typing import Optional, Dict, Any, Tuple
from dotenv import load_dotenv
import asyncpg
import httpx

# Import executors
from executors import initialize_executors

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is required")

SERVER_URL = os.getenv("SERVER_URL", "http://localhost:5000")
POLL_INTERVAL_SECONDS = 5

# --- Utilities ---

async def get_credential_secret(conn: asyncpg.Connection, credential_id: int) -> Optional[str]:
    """Get secret value for a credential from environment variables."""
    credential = await conn.fetchrow(
        "SELECT env_var_name FROM credentials WHERE id = $1",
        credential_id
    )
    if not credential: return None
    return os.getenv(credential["env_var_name"])

async def upload_file_to_gemini(conn: asyncpg.Connection, asset: dict, api_key: str) -> Optional[dict]:
    """Upload a RAG asset file to Gemini Files API."""
    try:
        import base64
        import mimetypes
        
        file_content = None
        mime_type = asset.get("content_type") or "application/octet-stream"
        file_name = asset.get("name", "file")
        
        if asset.get("file_data"):
            file_content = base64.b64decode(asset["file_data"].split(",")[-1] if "," in asset["file_data"] else asset["file_data"])
        elif asset.get("text_content"):
            file_content = asset["text_content"].encode("utf-8")
            mime_type = "text/plain"
            file_name = f"{file_name}.txt"
        elif asset.get("url"):
            async with httpx.AsyncClient() as client:
                url_response = await client.get(asset["url"])
                if url_response.status_code == 200:
                    file_content = url_response.content
                    mime_type = url_response.headers.get("content-type", "application/octet-stream").split(";")[0]
        
        if not file_content: return None

        upload_url = f"https://generativelanguage.googleapis.com/upload/v1beta/files?key={api_key}"
        boundary = f"----WebKitFormBoundary{int(datetime.now().timestamp() * 1000)}"
        metadata_json = json.dumps({"file": {"displayName": file_name}})
        
        body = b"".join([
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n',
            f"{metadata_json}\r\n".encode(),
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{file_name}"\r\nContent-Type: {mime_type}\r\n\r\n'.encode(),
            file_content,
            f"\r\n--{boundary}--\r\n".encode(),
        ])
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(upload_url, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}, content=body)
            if res.status_code != 200: return None
            data = res.json()
            return {"fileUri": data["file"]["uri"], "mimeType": mime_type}
    except Exception as e:
        print(f"Gemini upload error: {e}")
        return None

def supports_gemini_file_attachments(model: str) -> bool:
    if not model: return False
    return any(k in model.lower() for k in ["gemini-1.5", "gemini-2.0", "gemini-2.5"])

def build_rag_context_from_assets(assets: list) -> str:
    sections = []
    for asset in assets:
        name, atype = asset.get("name", "Unknown"), asset.get("asset_type", "Unknown")
        body = asset.get("text_content") or f"Resource: {asset.get('url', 'Unknown')}"
        sections.append(f"=== RAG Asset: {name} ({atype}) ===\n{body}")
    return "\n\n".join(sections)

async def resolve_item_variables(template: str, item: Dict[str, Any], item_index: int) -> str:
    import re
    resolved = template
    bracket_pattern = r'\{\{item\["([^"]+)"\]\}\}'
    resolved = re.sub(bracket_pattern, lambda m: json.dumps(item.get(m.group(1), "")), resolved)
    dot_pattern = r'\{\{item\.([a-zA-Z_][a-zA-Z0-9_]*)\}\}'
    resolved = re.sub(dot_pattern, lambda m: json.dumps(item.get(m.group(1), "")) if isinstance(item.get(m.group(1)), (dict, list)) else str(item.get(m.group(1), "")), resolved)
    return resolved.replace("{{item.index}}", str(item_index))

# --- Core Execution Logic ---

async def execute_pipeline(pipeline_id: int, input_data: Optional[str] = None) -> Tuple[bool, str]:
    try:
        url = f"{SERVER_URL}/api/pipelines/{pipeline_id}/execute"
        async with httpx.AsyncClient(timeout=300.0) as client:
            res = await client.post(url, json={"input": input_data} if input_data else {})
            if res.status_code == 200:
                data = res.json()
                return data.get("success", False), f"Pipeline started: {data.get('executionId', 'unknown')}"
            return False, f"API error {res.status_code}: {res.text[:200]}"
    except Exception as e:
        return False, str(e)

async def execute_job(conn: asyncpg.Connection, job_id: int, job_type: str, job_config: Dict[str, Any], 
                      input_data: Optional[str] = None, job_tool: Optional[str] = None) -> Tuple[bool, str]:
    if job_config.get("pipelineId"):
        return await execute_pipeline(job_config["pipelineId"], input_data)
    
    executor = executor_registry.get_executor(job_type)
    if not executor:
        return False, f"Unknown job type: {job_type}"
    
    return await executor.execute(conn, job_id, job_config, input_data, job_tool)

# --- Queue Processing ---

async def process_job_queue(conn: asyncpg.Connection):
    try:
        ready_jobs = await conn.fetch("""
            SELECT wq.item_id, wq.job_id, wq.scheduled_job_id, wq.payload,
                   j.type as job_type, j.config as job_config, j.name as job_name, j.tool
            FROM work_queue wq INNER JOIN jobs j ON wq.job_id = j.id
            WHERE wq.status = 'ready' AND wq.due_at <= NOW()
            ORDER BY wq.priority ASC, wq.due_at ASC LIMIT 10
        """)
        
        for q in ready_jobs:
            item_id = q["item_id"]
            await conn.execute("UPDATE work_queue SET status='leased', leased_at=NOW(), leased_by='runner' WHERE item_id=$1", item_id)
            
            try:
                config = json.loads(q["job_config"]) if q["job_config"] else {}
                payload = json.loads(q["payload"]) if q["payload"] else {}
                success, output = await execute_job(conn, q["job_id"], q["job_type"], config, payload.get("input"), q["tool"])
                
                # Store output if enabled
                if success and output:
                    job_info = await conn.fetchrow("SELECT output_storage_enabled, output_knowledge_topic_id FROM jobs WHERE id=$1", q["job_id"])
                    if job_info and job_info["output_storage_enabled"] and job_info["output_knowledge_topic_id"]:
                        async with httpx.AsyncClient() as client:
                            await client.post(f"{SERVER_URL}/api/jobs/{q['job_id']}/store-output", 
                                             json={"output": output, "status": "success", "workQueueItemId": item_id})
                
                await conn.execute("UPDATE work_queue SET status=$1, updated_at=NOW() WHERE item_id=$2", "done" if success else "dead", item_id)
                
                # Alerting logic would go here if needed (simplified for refactoring)
                print(f"Job {q['job_id']} {'completed' if success else 'failed'}")
                
            except Exception as e:
                print(f"Execution error: {e}")
                await conn.execute("UPDATE work_queue SET status='dead', error_last=$1, updated_at=NOW() WHERE item_id=$2", str(e)[:500], item_id)
                
    except Exception as e:
        print(f"Queue error: {e}")

async def main():
    global executor_registry
    executor_registry = initialize_executors()
    print("Runner started with strategy pattern executors.")
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        while True:
            await process_job_queue(conn)
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(main())
