
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import json
from datetime import datetime

from api.dependencies.services import get_ai_extraction_service
from services.ai_extraction_service import AIExtractionService, ExtractedField
from core.auth_middleware import get_current_user, AuthenticatedUser
from core.database import get_pool
from core.logging import get_logger
from core.api_responses import success_response, error_response

logger = get_logger(__name__)
router = APIRouter()

class ExtractFieldsRequest(BaseModel):
    templateId: int
    templateContent: str

class FormAgentCreateRequest(BaseModel):
    documentTemplateId: int
    name: str
    description: Optional[str] = None
    config: Dict[str, Any]

@router.post("/extract-fields")
async def extract_fields(
    request: ExtractFieldsRequest,
    ai_service: AIExtractionService = Depends(get_ai_extraction_service),
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    try:
        logger.info(f"Extracting fields for template {request.templateId}")
        fields = await ai_service.extract_fields(request.templateContent)
        
        # Manually convert to dict to avoid serialization issues with success_response
        fields_data = []
        for f in fields:
            fields_data.append({
                "name": f.name,
                "type": f.type,
                "label": f.label,
                "required": f.required,
                "options": f.options,
                "aiConfidence": f.aiConfidence,
                "description": f.description,
                "defaultValue": f.defaultValue
            })
            
        return success_response(data={"fields": fields_data})
    except Exception as e:
        logger.error(f"Error extracting fields: {e}", exc_info=True)
        return error_response(f"Failed to extract fields: {str(e)}", 500)

@router.post("")
async def create_form_agent(
    request: FormAgentCreateRequest,
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    """
    Create a new form agent job.
    """
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            logger.info(f"Creating form agent job: {request.name} for user {current_user.user_id}")
            
            # 1. Verify user exists and get organization context
            # (In a real system, we might want to ensure the user belongs to the org they are creating in)
            user_data = await conn.fetchrow(
                "SELECT default_org_id FROM users WHERE id = $1",
                str(current_user.user_id)
            )
            
            if not user_data and current_user.user_id != "system":
                logger.warning(f"User {current_user.user_id} not found in database during job creation")
                # We'll continue but organization_id will be None
                user_org_id = None
            else:
                user_org_id = user_data["default_org_id"] if user_data else None
            
            # 2. Check for duplicate name in the same organization to provide better error
            existing_job = await conn.fetchval(
                "SELECT id FROM jobs WHERE name = $1 AND organization_id IS NOT DISTINCT FROM $2",
                request.name,
                user_org_id
            )
            
            if existing_job:
                return error_response(
                    f"A job with the name '{request.name}' already exists in this organization.",
                    409 # Conflict
                )
            
            # 3. Insert into jobs table
            # We pass the config dict directly - asyncpg handles JSONB conversion
            query = """
                INSERT INTO jobs (
                    name, description, type, config, 
                    created_by, organization_id, lifecycle_status, is_active,
                    created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
                ) RETURNING id
            """
            
            try:
                job_id = await conn.fetchval(
                    query,
                    request.name,
                    request.description,
                    "form_agent",
                    json.dumps(request.config),
                    str(current_user.user_id),
                    user_org_id,
                    "active",
                    True
                )
                
                logger.info(f"Successfully created form agent job {job_id}")
                
                return success_response(
                    data={"id": job_id},
                    message="Form agent created successfully"
                )
            except Exception as db_err:
                # Handle specific DB errors if needed
                if "unique constraint" in str(db_err).lower():
                     return error_response(f"Constraint violation: {str(db_err)}", 409)
                raise db_err

    except Exception as e:
        logger.error(f"Error creating form agent: {e}", exc_info=True)
        return error_response(f"Failed to create form agent: {str(e)}", 500)
