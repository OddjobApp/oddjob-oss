import json
import os
from typing import Dict, Any, Optional, Tuple
import asyncpg
from openai import OpenAI
from anthropic import Anthropic
import httpx
from datetime import datetime
from .base import BaseExecutor

class AIExecutor(BaseExecutor):
    async def execute(self, conn: asyncpg.Connection, job_id: int, job_config: Dict[str, Any], 
                      input_data: Optional[str] = None, job_tool: Optional[str] = None) -> Tuple[bool, str]:
        try:
            credential_id = job_config.get("credentialId")
            if not credential_id:
                return False, "No credential ID specified"
            
            # This would normally be imported from a shared utility
            from runner import get_credential_secret, upload_file_to_gemini, supports_gemini_file_attachments, build_rag_context_from_assets
            
            api_key = await get_credential_secret(conn, credential_id)
            if not api_key:
                return False, f"Credential {credential_id} not found in environment"
            
            credential = await conn.fetchrow(
                "SELECT type, metadata FROM credentials WHERE id = $1",
                credential_id
            )
            if not credential:
                return False, f"Credential {credential_id} not found"
            
            metadata = json.loads(credential["metadata"]) if credential["metadata"] else {}
            provider = metadata.get("provider", "openai")
            
            user_prompt = job_config.get("userPrompt", "")
            if input_data and "{{input}}" in user_prompt:
                user_prompt = user_prompt.replace("{{input}}", input_data)
            
            system_prompt = job_config.get("systemPrompt")
            model = job_config.get("model", "gpt-4")
            temperature = job_config.get("temperature", 0.7)
            max_tokens = job_config.get("maxTokens")
            
            gemini_file_attachments = []
            if job_tool == "RAG Resource":
                rag_assets = await conn.fetch(
                    """
                    SELECT id, name, asset_type, source_type, content_type, file_size, file_data, text_content, url, "order"
                    FROM rag_assets
                    WHERE job_id = $1
                    ORDER BY "order" ASC
                    """,
                    job_id
                )
                
                if rag_assets and provider == "google":
                    if not supports_gemini_file_attachments(model):
                        return False, f'Gemini model "{model}" does not support file attachments.'
                    
                    for asset in rag_assets:
                        file_info = await upload_file_to_gemini(conn, dict(asset), api_key)
                        if file_info:
                            gemini_file_attachments.append(file_info)
                elif rag_assets:
                    rag_context = build_rag_context_from_assets([dict(asset) for asset in rag_assets])
                    if rag_context:
                        user_prompt = f"{user_prompt}\n\n=== RAG Context ===\n{rag_context}".strip()
            
            if provider == "openai":
                client = OpenAI(api_key=api_key)
                messages = []
                if system_prompt: messages.append({"role": "system", "content": system_prompt})
                messages.append({"role": "user", "content": user_prompt})
                extra_params = {}
                if job_config.get("requestType") == "json": extra_params["response_format"] = {"type": "json_object"}
                response = client.chat.completions.create(model=model, messages=messages, temperature=temperature, max_tokens=max_tokens, **extra_params)
                output = response.choices[0].message.content
            elif provider == "anthropic":
                client = Anthropic(api_key=api_key)
                response = client.messages.create(model=model, messages=[{"role": "user", "content": user_prompt}], temperature=temperature, max_tokens=max_tokens, system=system_prompt)
                output = response.content[0].text
            elif provider == "google":
                async with httpx.AsyncClient() as client:
                    parts = [{"text": user_prompt}]
                    for att in gemini_file_attachments: parts.append({"fileData": {"fileUri": att["fileUri"], "mimeType": att["mimeType"]}})
                    request_payload = {"contents": [{"parts": parts}], "generationConfig": {"temperature": temperature}}
                    if job_config.get("requestType") == "json": request_payload["generationConfig"]["responseMimeType"] = "application/json"
                    if max_tokens: request_payload["generationConfig"]["maxOutputTokens"] = max_tokens
                    if system_prompt: request_payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
                    response = await client.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}", json=request_payload)
                    result = response.json()
                    output = result["candidates"][0]["content"]["parts"][0]["text"]
            else:
                return False, f"Unknown AI provider: {provider}"
            
            return True, output
        except Exception as e:
            return False, str(e)
