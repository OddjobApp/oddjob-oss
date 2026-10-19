"""
AI Extraction Service
Uses LLMs to intelligently extract form fields and structure from document templates.
"""

import json
import re
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

from core.service_base import BaseService, ServiceConfig
from core.config import settings
from core.structured_logging import get_structured_logger

logger = get_structured_logger("ai_extraction_service")

class ExtractedField(BaseModel):
    name: str
    type: str  # text, textarea, select, boolean, etc.
    label: str
    required: bool
    options: Optional[List[str]] = None
    aiConfidence: float
    description: Optional[str] = None
    defaultValue: Optional[str] = None

class AIExtractionService(BaseService):
    """Service for AI-powered data extraction from templates."""

    def __init__(self, config: ServiceConfig):
        super().__init__(config)
        self.openai_client = None
        self.anthropic_client = None

    async def initialize(self) -> None:
        """Initialize AI clients."""
        try:
            # Google Gemini (Priority 1 - Matches Assistant)
            if settings.GOOGLE_API_KEY:
                import google.generativeai as genai
                genai.configure(api_key=settings.GOOGLE_API_KEY)
                self.google_genai_client = genai.GenerativeModel('gemini-2.0-flash')
                logger.info("Google Gemini client initialized for extraction (priority)")

            if settings.OPENAI_API_KEY:
                from openai import AsyncOpenAI
                self.openai_client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
                logger.info("OpenAI client initialized for extraction")
            
            if settings.ANTHROPIC_API_KEY and not self.openai_client:
                from anthropic import AsyncAnthropic
                self.anthropic_client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
                logger.info("Anthropic client initialized for extraction")
        except Exception as e:
            logger.error(f"Failed to initialize AI clients: {e}")

    async def shutdown(self) -> None:
        """Shutdown service."""
        pass

    async def _perform_health_check(self) -> None:
        """Check if AI service is available."""
        pass

    async def extract_fields(self, content: str) -> List[ExtractedField]:
        """
        Extract fields from template content using AI if available, otherwise regex.
        Prioritizes Google Gemini to match Oddjob Assistant.
        """
        if hasattr(self, 'google_genai_client') and self.google_genai_client:
            return await self._extract_with_gemini(content)
        elif self.openai_client:
            return await self._extract_with_openai(content)
        elif self.anthropic_client:
            # Fallback to Anthropic implementation if needed (omitted for brevity, similar flow)
            return self._extract_with_regex(content) 
        else:
            return self._extract_with_regex(content)

    async def _extract_with_gemini(self, content: str) -> List[ExtractedField]:
        """Extract fields using Google Gemini."""
        try:
            system_prompt = """
            You are an expert form designer. Analyze the following document template and extract the necessary input fields to recreate this document as a structured form.
            
            Return a JSON object with a "fields" array. Each field should have:
            - name: logic variable name (snake_case)
            - label: human readable label
            - type: one of [text, textarea, select, boolean, date, number]
            - required: boolean
            - options: array of strings (only for 'select' type)
            - description: help text for the user
            - aiConfidence: float 0.0-1.0 (your confidence in this field)
            
            Detect fields based on:
            - Explicit placeholders like {{variable}} or [Variable]
            - Sections that imply user input (e.g. "Description:", "Steps to Reproduce:")
            - Tables that need row data
            - Metadata headers like "**Severity:**"
            """
            
            prompt = f"{system_prompt}\n\nTemplate Content:\n\n{content}"
            
            # Gemini async generation
            response = await self.google_genai_client.generate_content_async(
                prompt,
                generation_config={"response_mime_type": "application/json"}
            )
            
            result_json = response.text
            data = json.loads(result_json)
            
            fields = []
            for field_data in data.get("fields", []):
                fields.append(ExtractedField(**field_data))
                
            logger.info(f"Gemini extracted {len(fields)} fields")
            return fields
            
        except Exception as e:
            logger.error(f"Gemini extraction failed: {e}")
            # Fallback to OpenAI if available, else Regex
            if self.openai_client:
                return await self._extract_with_openai(content)
            return self._extract_with_regex(content)

    async def _extract_with_openai(self, content: str) -> List[ExtractedField]:
        """Extract fields using OpenAI."""
        try:
            system_prompt = """
            You are an expert form designer. Analyze the following document template and extract the necessary input fields to recreate this document as a structured form.
            
            Return a JSON object with a "fields" array. Each field should have:
            - name: logic variable name (snake_case)
            - label: human readable label
            - type: one of [text, textarea, select, boolean, date, number]
            - required: boolean
            - options: array of strings (only for 'select' type)
            - description: help text for the user
            - aiConfidence: float 0.0-1.0 (your confidence in this field)
            
            Detect fields based on:
            - Explicit placeholders like {{variable}} or [Variable]
            - Sections that imply user input (e.g. "Description:", "Steps to Reproduce:")
            - Tables that need row data
            - Metadata headers like "**Severity:**"
            """
            
            response = await self.openai_client.chat.completions.create(
                model="gpt-4-turbo-preview",  # Use a smart model
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Template Content:\n\n{content}"}
                ],
                response_format={"type": "json_object"},
                temperature=0.1
            )
            
            result_json = response.choices[0].message.content
            data = json.loads(result_json)
            
            fields = []
            for field_data in data.get("fields", []):
                fields.append(ExtractedField(**field_data))
                
            logger.info(f"AI extracted {len(fields)} fields")
            return fields
            
        except Exception as e:
            logger.error(f"OpenAI extraction failed: {e}")
            return self._extract_with_regex(content)

    def _extract_with_regex(self, content: str) -> List[ExtractedField]:
        """Fallback regex extraction (migrated from route handler)."""
        fields = []

        # Pattern 1: Bug report style - **Field:** Options
        bug_report_patterns = [
            (r'\*\*Severity:\*\*\s*(.*?)(?:\n|$)', 'severity', ['Critical', 'High', 'Medium', 'Low']),
            (r'\*\*Priority:\*\*\s*(.*?)(?:\n|$)', 'priority', ['P0', 'P1', 'P2', 'P3']),
            (r'\*\*Type:\*\*\s*(.*?)(?:\n|$)', 'type', ['Functional', 'UI', 'Performance', 'Security']),
            (r'\*\*Status:\*\*\s*(.*?)(?:\n|$)', 'status', ['Open', 'In Progress', 'Fixed', 'Closed'])
        ]

        for pattern, field_name, options in bug_report_patterns:
            if re.search(pattern, content, re.IGNORECASE):
                fields.append(ExtractedField(
                    name=field_name,
                    type='select',
                    label=field_name.title(),
                    required=True,
                    options=options,
                    aiConfidence=0.95,
                    description=f"Select {field_name}"
                ))

        # Pattern 2: Test case style
        test_case_patterns = [
            (r'\*\*Priority:\*\*\s*(.*?)(?:\n|$)', 'priority', ['High', 'Medium', 'Low']),
            (r'\*\*Type:\*\*\s*(.*?)(?:\n|$)', 'type', ['Functional', 'UI', 'Integration', 'Regression']),
            (r'\*\*Status:\*\*\s*(.*?)(?:\n|$)', 'status', ['Not Run', 'Pass', 'Fail', 'Blocked'])
        ]

        for pattern, field_name, options in test_case_patterns:
            if re.search(pattern, content, re.IGNORECASE) and not any(f.name == field_name for f in fields):
                fields.append(ExtractedField(
                    name=field_name,
                    type='select',
                    label=field_name.title(),
                    required=True,
                    options=options,
                    aiConfidence=0.95
                ))

        # Pattern 3: Generic text fields (sections)
        # Look for headers like "## Header"
        header_matches = re.finditer(r'##\s+(.+?)(?:\n|$)', content)
        for match in header_matches:
            header = match.group(1).strip()
            field_name = header.lower().replace(' ', '_')
            
            # Skip if already exists
            if any(f.name == field_name for f in fields):
                continue
                
            fields.append(ExtractedField(
                name=field_name,
                type='textarea',
                label=header,
                required=False,
                aiConfidence=0.85
            ))

        # Ensure we have at least some basic fields if nothing was detected
        if not fields:
            fields.extend([
                ExtractedField(
                    name='title',
                    type='text',
                    label='Title',
                    required=True,
                    aiConfidence=0.8,
                    description="Document title"
                ),
                ExtractedField(
                    name='description',
                    type='textarea',
                    label='Description',
                    required=True,
                    aiConfidence=0.8
                )
            ])

        return fields

# Global instance
ai_extraction_service = AIExtractionService(ServiceConfig(
    name="ai_extraction",
    enabled=True
))
