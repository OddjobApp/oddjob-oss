"""
PDF Service
Business logic for PDF parsing and content extraction
"""

import io
from typing import Dict, Any, Optional, Union
from pypdf import PdfReader

from core.config import settings
from core.exceptions import ValidationError, ProcessingError
from core.logging import get_logger

logger = get_logger(__name__)


class PDFService:
    """Service for PDF parsing and content extraction."""

    def __init__(self):
        self.max_size_mb = settings.MAX_PDF_SIZE_MB
        self.processing_timeout = settings.PDF_PROCESSING_TIMEOUT

    async def parse_pdf(
        self,
        content: bytes,
        filename: str,
        extract_text: bool = True,
        extract_images: bool = False,
        extract_tables: bool = False
    ):
        """Parse PDF content and extract requested information."""
        """
        Parse PDF content and extract requested information.

        Args:
            content: PDF file content as bytes
            filename: Original filename
            extract_text: Whether to extract text content
            extract_images: Whether to extract images (not implemented)
            extract_tables: Whether to extract tables (not implemented)

        Returns:
            Dictionary containing extracted content and metadata
        """
        try:
            logger.info(f"Starting PDF parsing for file: {filename}")

            # Validate file size
            file_size_mb = len(content) / (1024 * 1024)
            if file_size_mb > self.max_size_mb:
                raise ValidationError(f"PDF file size ({file_size_mb:.1f}MB) exceeds maximum allowed size ({self.max_size_mb}MB)")

            # Create PDF reader
            pdf_file = io.BytesIO(content)
            reader = PdfReader(pdf_file)

            # Extract metadata
            metadata = self._extract_metadata(reader, filename)

            result: Dict[str, Any] = {
                "metadata": metadata
            }

            # Extract text content
            if extract_text:
                result["text_content"] = self._extract_text_content(reader)

            # Note: Image and table extraction would require additional libraries
            if extract_images:
                logger.warning("Image extraction not implemented")
                result["images"] = []

            if extract_tables:
                logger.warning("Table extraction not implemented")
                result["tables"] = []

            logger.info(f"Successfully parsed PDF: {filename}")
            return result

        except Exception as e:
            logger.error(f"Failed to parse PDF {filename}: {str(e)}", exc_info=True)
            if isinstance(e, ValidationError):
                raise
            raise ProcessingError(f"PDF parsing failed: {str(e)}", "pdf_parsing")

    def _extract_metadata(self, reader: PdfReader, filename: str) -> Dict[str, Any]:
        """Extract metadata from PDF."""
        metadata = {
            "filename": filename,
            "pages": len(reader.pages),
            "file_size_bytes": reader.stream.tell() if hasattr(reader.stream, 'tell') else None,
        }

        # Extract PDF metadata
        pdf_metadata = reader.metadata
        if pdf_metadata:
            metadata.update({
                "title": pdf_metadata.title,
                "author": pdf_metadata.author,
                "subject": pdf_metadata.subject,
                "creator": pdf_metadata.creator,
                "producer": pdf_metadata.producer,
                "creation_date": str(pdf_metadata.creation_date) if pdf_metadata.creation_date else None,
                "modification_date": str(pdf_metadata.modification_date) if pdf_metadata.modification_date else None,
            })

        return metadata

    def _extract_text_content(self, reader: PdfReader) -> str:
        """Extract text content from all pages."""
        text_content = []

        for page_num, page in enumerate(reader.pages):
            try:
                page_text = page.extract_text()
                if page_text.strip():
                    text_content.append(page_text.strip())
            except Exception as e:
                logger.warning(f"Failed to extract text from page {page_num + 1}: {str(e)}")

        return '\n\n'.join(text_content)