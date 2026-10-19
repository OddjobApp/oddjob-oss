"""
Embedder Service
Business logic for text embedding generation
"""

import os
from typing import List, Optional
import numpy as np

from sentence_transformers import SentenceTransformer
from core.config import settings
from core.exceptions import ProcessingError, ConfigurationError, ValidationError
from core.logging import get_logger

logger = get_logger(__name__)


class EmbedderService:
    """Service for generating text embeddings using Sentence Transformers."""

    def __init__(self):
        self._model: Optional[SentenceTransformer] = None
        self._model_name: str = settings.EMBEDDING_MODEL

    async def generate_embedding(
        self,
        text: str,
        model: Optional[str] = None
    ) -> List[float]:
        """
        Generate embedding for a single text.

        Args:
            text: Text to embed
            model: Optional model override

        Returns:
            List of float values representing the embedding

        Raises:
            ValidationError: If text is invalid
            ProcessingError: If embedding generation fails
        """
        if not text or not text.strip():
            raise ValidationError("Text cannot be empty")

        if len(text) > 10000:
            raise ValidationError("Text exceeds maximum length of 10,000 characters")

        try:
            # Get or load model
            model_instance = await self._get_model(model)

            # Generate embedding
            embedding = model_instance.encode(text, convert_to_numpy=True)

            # Convert to list for JSON serialization
            return embedding.tolist()

        except Exception as e:
            logger.error(f"Failed to generate embedding: {str(e)}", exc_info=True)
            raise ProcessingError(f"Embedding generation failed: {str(e)}", "text_embedding")

    async def generate_batch_embeddings(
        self,
        texts: List[str],
        model: Optional[str] = None
    ) -> List[List[float]]:
        """
        Generate embeddings for multiple texts in batch.

        Args:
            texts: List of texts to embed
            model: Optional model override

        Returns:
            List of embeddings, one for each input text
        """
        if not texts:
            raise ValidationError("Texts list cannot be empty")

        if len(texts) > 100:
            raise ValidationError("Batch size cannot exceed 100 texts")

        # Validate all texts
        for i, text in enumerate(texts):
            if not text or not text.strip():
                raise ValidationError(f"Text at index {i} cannot be empty")
            if len(text) > 10000:
                raise ValidationError(f"Text at index {i} exceeds maximum length of 10,000 characters")

        try:
            # Get or load model
            model_instance = await self._get_model(model)

            # Generate embeddings in batch
            embeddings = model_instance.encode(texts, convert_to_numpy=True)

            # Convert to list of lists for JSON serialization
            return embeddings.tolist()

        except Exception as e:
            logger.error(f"Failed to generate batch embeddings: {str(e)}", exc_info=True)
            raise ProcessingError(f"Batch embedding generation failed: {str(e)}", "batch_text_embedding")

    async def _get_model(self, model_name: Optional[str] = None) -> SentenceTransformer:
        """Get or load the embedding model."""
        requested_model = model_name or self._model_name

        if self._model is None or self._model_name != requested_model:
            try:
                logger.info(f"Loading embedding model: {requested_model}")
                self._model = SentenceTransformer(requested_model)
                self._model_name = requested_model
                logger.info("Embedding model loaded successfully")
            except Exception as e:
                logger.error(f"Failed to load embedding model {requested_model}: {str(e)}")
                raise ConfigurationError(f"Failed to load embedding model: {str(e)}")

        return self._model

    def get_model_name(self) -> str:
        """Get the current model name."""
        return self._model_name

    def get_model_info(self) -> dict:
        """Get information about the current model."""
        if self._model is None:
            return {"loaded": False, "model_name": self._model_name}

        return {
            "loaded": True,
            "model_name": self._model_name,
            "max_seq_length": getattr(self._model, 'max_seq_length', None),
            "embedding_dimension": self._model.get_sentence_embedding_dimension()
        }