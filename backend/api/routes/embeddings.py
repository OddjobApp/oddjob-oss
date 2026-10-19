"""
Embeddings Routes
API endpoints for text embedding generation
"""

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
import time

from api.dependencies.services import get_embedder_service
from services.embedder_service import EmbedderService
from core.exceptions import ValidationError, ProcessingError
from core.logging import get_logger
from core.input_validation import RequestValidator
from core.auth_middleware import get_current_user, AuthenticatedUser

logger = get_logger(__name__)

router = APIRouter()


class EmbedRequest(BaseModel):
    """Request model for text embedding."""
    text: str
    model: Optional[str] = None

    @field_validator('text')
    @classmethod
    def validate_text(cls, v):
        return RequestValidator.validate_text_input(v, 10000)


class EmbedResponse(BaseModel):
    """Response model for embedding results."""
    embedding: List[float]
    model: str
    dimensions: int
    processing_time: float


class BatchEmbedRequest(BaseModel):
    """Request model for batch text embedding."""
    texts: List[str]
    model: Optional[str] = None

    @field_validator('texts')
    @classmethod
    def validate_texts(cls, v):
        if not v or len(v) == 0:
            raise ValueError('Texts list cannot be empty')
        if len(v) > 100:
            raise ValueError('Batch size cannot exceed 100 texts')
        for i, text in enumerate(v):
            if not text or not text.strip():
                raise ValueError(f'Text at index {i} cannot be empty')
        return v


class BatchEmbedResponse(BaseModel):
    """Response model for batch embedding results."""
    embeddings: List[List[float]]
    model: str
    dimensions: int
    total_texts: int
    processing_time: float


@router.post("/embed", response_model=EmbedResponse)
async def generate_embedding(
    request: EmbedRequest,
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser = Depends(get_current_user),
    embedder: EmbedderService = Depends(get_embedder_service)
) -> EmbedResponse:
    """
    Generate embeddings for the provided text.

    This endpoint processes text input and returns vector embeddings
    that can be used for semantic search and similarity matching.
    """
    start_time = time.time()

    try:
        logger.info(f"Generating embedding for text (length: {len(request.text)})")

        # Generate embedding
        embedding = await embedder.generate_embedding(
            text=request.text,
            model=request.model
        )

        processing_time = time.time() - start_time

        logger.info(
            f"Embedding generated successfully in {processing_time:.3f}s",
            extra={
                "dimensions": len(embedding),
                "processing_time": processing_time
            }
        )

        return EmbedResponse(
            embedding=embedding,
            model=embedder.get_model_name(),
            dimensions=len(embedding),
            processing_time=processing_time
        )

    except ValidationError as e:
        logger.warning(f"Validation error in embedding request: {e.message}")
        raise HTTPException(status_code=400, detail=e.message)
    except ProcessingError as e:
        logger.error(f"Processing error in embedding generation: {e.message}")
        raise HTTPException(status_code=422, detail=e.message)
    except Exception as e:
        logger.error(f"Unexpected error in embedding generation: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/embed/batch", response_model=BatchEmbedResponse)
async def generate_batch_embeddings(
    request: BatchEmbedRequest,
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser = Depends(get_current_user),
    embedder: EmbedderService = Depends(get_embedder_service)
) -> BatchEmbedResponse:
    """
    Generate embeddings for multiple texts in batch.

    This endpoint processes multiple text inputs efficiently and returns
    vector embeddings for each text.
    """
    start_time = time.time()

    try:
        logger.info(f"Generating batch embeddings for {len(request.texts)} texts")

        # Validate input
        for i, text in enumerate(request.texts):
            if not text or not text.strip():
                raise ValidationError(f"Text at index {i} is empty or whitespace only")

        # Generate embeddings
        embeddings = await embedder.generate_batch_embeddings(
            texts=request.texts,
            model=request.model
        )

        processing_time = time.time() - start_time

        logger.info(
            f"Batch embeddings generated successfully in {processing_time:.3f}s",
            extra={
                "total_texts": len(embeddings),
                "dimensions": len(embeddings[0]) if embeddings else 0,
                "processing_time": processing_time
            }
        )

        return BatchEmbedResponse(
            embeddings=embeddings,
            model=embedder.get_model_name(),
            dimensions=len(embeddings[0]) if embeddings else 0,
            total_texts=len(embeddings),
            processing_time=processing_time
        )

    except ValidationError as e:
        logger.warning(f"Validation error in batch embedding request: {e.message}")
        raise HTTPException(status_code=400, detail=e.message)
    except ProcessingError as e:
        logger.error(f"Processing error in batch embedding generation: {e.message}")
        raise HTTPException(status_code=422, detail=e.message)
    except Exception as e:
        logger.error(f"Unexpected error in batch embedding generation: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")