import asyncio
import json
import uuid
import time
from typing import Dict, Any, Optional, Callable, Awaitable
from core.redis_client import get_redis_client
from core.config import settings
from core.logging import get_logger

# Import services lazily to avoid circular imports
from api.dependencies.services import (
    get_embedder_service,
    get_scraper_service,
    get_pdf_service,
    get_ai_extraction_service
)

logger = get_logger(__name__)

# IPC Names (must match Node)
TASK_STREAM = "ipc:python:tasks"
RESULT_KEY_PREFIX = "ipc:node:results:"

class IPCService:
    def __init__(self):
        self.redis = None
        self.running = False
        self._handlers: Dict[str, Callable[[Any], Awaitable[Any]]] = {}

    def register_handler(self, action: str, handler: Callable[[Any], Awaitable[Any]]):
        self._handlers[action] = handler
        logger.info(f"Registered IPC handler: {action}")

    async def initialize(self):
        self.redis = get_redis_client()
        
        # Register default handlers
        self.register_handler("embed", self._handle_embed)
        self.register_handler("scrape", self._handle_scrape)
        self.register_handler("parse_pdf", self._handle_parse_pdf)
        self.register_handler("distill", self._handle_distill)
        self.register_handler("execute_script", self._handle_execute_script)
        
        logger.info("IPC Service initialized")

    async def start(self):
        self.running = True
        logger.info(f"Starting IPC Service (listening on {TASK_STREAM})...")
        
        # Ensure group exists (optional if we don't use consumer groups yet)
        try:
            await self.redis.xgroup_create(TASK_STREAM, "python_workers", id="0", mkstream=True)
        except Exception:
            pass # Already exists

        while self.running:
            try:
                # Read from stream (blocking)
                # We use xreadgroup for better parallel processing if we scale
                messages = await self.redis.xreadgroup(
                    "python_workers", "worker_1", {TASK_STREAM: ">"}, count=1, block=5000
                )
                
                if not messages:
                    continue

                for stream_name, msg_list in messages:
                    for msg_id, data in msg_list:
                        await self._process_message(msg_id, data)
                        
            except Exception as e:
                logger.error(f"Error in IPC loop: {e}", exc_info=True)
                await asyncio.sleep(1)

    async def _process_message(self, msg_id: str, data: Dict[str, str]):
        request_id = data.get("requestId")
        action = data.get("action")
        payload_str = data.get("data", "{}")
        
        if not request_id or not action:
            logger.warning(f"Malformed IPC message: {data}")
            await self.redis.xack(TASK_STREAM, "python_workers", msg_id)
            return

        logger.info(f"Processing IPC request: {action} ({request_id})")
        
        try:
            payload = json.loads(payload_str)
            
            if action not in self._handlers:
                raise ValueError(f"No handler for action: {action}")
            
            # Execute handler
            result = await self._handlers[action](payload)
            
            # Send success response
            await self._send_response(request_id, {"success": True, "result": result})
            
        except Exception as e:
            logger.error(f"Failed to process IPC request {request_id}: {e}")
            await self._send_response(request_id, {"success": False, "error": str(e)})
        
        finally:
            # Acknowledge message
            await self.redis.xack(TASK_STREAM, "python_workers", msg_id)
            # Delete message to keep stream clean? Usually handled by XTRIM or retention policy.

    async def _send_response(self, request_id: str, response: Dict[str, Any]):
        result_key = f"{RESULT_KEY_PREFIX}{request_id}"
        await self.redis.lpush(result_key, json.dumps(response))
        # Set short TTL in case Node is gone
        await self.redis.expire(result_key, 60)

    # --- Handlers ---

    async def _handle_embed(self, data: Any):
        text = data.get("text")
        service = get_embedder_service()
        embedding = await service.generate_embedding(text)
        return {"embedding": embedding}

    async def _handle_scrape(self, data: Any):
        url = data.get("url")
        service = get_scraper_service()
        return await service.scrape_url(url)

    async def _handle_parse_pdf(self, data: Any):
        import base64
        file_content_b64 = data.get("file_content")
        file_path = data.get("file_path")
        filename = data.get("filename", "document.pdf")
        
        content = None
        if file_content_b64:
            content = base64.b64decode(file_content_b64)
        elif file_path:
            with open(file_path, "rb") as f:
                content = f.read()
        
        if not content:
            raise ValueError("No PDF content or file path provided")
            
        from services.pdf_service import PDFService
        pdf_service = PDFService()
        result = await pdf_service.parse_pdf(content, filename)
        
        # Map to expected output format
        return {
            "text": result.get("text_content", ""),
            "metadata": result.get("metadata", {})
        }

    async def _handle_distill(self, data: Any):
        text = data.get("text", "")
        if not text:
            return {"summary": "", "original_language": "unknown", "translated_text": "", "char_count": 0}
            
        ai_service = get_ai_extraction_service()
        
        # Simple distillation using Gemini/OpenAI
        prompt = f"""
        Analyze the following text. 
        1. Identify the original language.
        2. Provide a concise summary (max 3 sentences).
        3. Translate it to English if it isn't already.
        
        Return JSON: {{"original_language": "...", "summary": "...", "translated_text": "..."}}
        
        Text: {text[:5000]}
        """
        
        try:
            if hasattr(ai_service, 'google_genai_client') and ai_service.google_genai_client:
                response = await ai_service.google_genai_client.generate_content_async(
                    prompt,
                    generation_config={"response_mime_type": "application/json"}
                )
                result = json.loads(response.text)
            elif ai_service.openai_client:
                response = await ai_service.openai_client.chat.completions.create(
                    model="gpt-4-turbo-preview",
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
                result = json.loads(response.choices[0].message.content)
            else:
                result = {"original_language": "unknown", "summary": text[:200] + "...", "translated_text": text}
                
            return {
                "original_language": result.get("original_language", "unknown"),
                "summary": result.get("summary", ""),
                "translated_text": result.get("translated_text", ""),
                "char_count": len(text)
            }
        except Exception as e:
            logger.error(f"Distillation failed: {e}")
            return {"summary": "Error during distillation", "original_language": "error", "translated_text": text, "char_count": len(text)}

    async def _handle_execute_script(self, data: Any):
        script = data.get("script")
        input_data = data.get("input_data", {})
        
        # Simple/Restricted execution
        # In a real system, this should be in a separate process/container
        globals_env = {"__builtins__": __builtins__}
        locals_env = {"input_data": input_data, "result": None}
        
        try:
            # Add a way to set result in script
            exec(script, globals_env, locals_env)
            return {"result": locals_env.get("result")}
        except Exception as e:
            logger.error(f"Script execution failed: {e}")
            raise

# Global instance
ipc_service = IPCService()
