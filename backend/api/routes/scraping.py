"""
Scraping Routes
API endpoints for web scraping and content extraction
"""

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, UploadFile, File
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import time

from api.dependencies.services import get_scraper_service, get_pdf_service
from services.scraper_service import ScraperService
from services.pdf_service import PDFService
from core.exceptions import ValidationError, ProcessingError, ExternalServiceError
from core.logging import get_logger
from core.auth_middleware import get_current_user, AuthenticatedUser

logger = get_logger(__name__)

router = APIRouter()


class ScrapeRequest(BaseModel):
    """Request model for web scraping."""
    url: str = Field(..., description="URL to scrape")
    timeout: Optional[int] = Field(30, ge=5, le=300, description="Request timeout in seconds")
    wait_for_selector: Optional[str] = Field(None, description="CSS selector to wait for")
    extract_text: bool = Field(True, description="Extract readable text content")
    extract_links: bool = Field(False, description="Extract all links from the page")


class ScrapeResponse(BaseModel):
    """Response model for scraping results."""
    url: str
    title: Optional[str]
    text_content: Optional[str]
    links: Optional[list[str]]
    metadata: Dict[str, Any]
    processing_time: float


class PDFParseRequest(BaseModel):
    """Request model for PDF parsing."""
    extract_text: bool = Field(True, description="Extract text content")
    extract_images: bool = Field(False, description="Extract images (not implemented)")
    extract_tables: bool = Field(False, description="Extract tables (not implemented)")


class PDFParseResponse(BaseModel):
    """Response model for PDF parsing results."""
    filename: str
    content_type: str
    size_bytes: int
    text_content: Optional[str]
    metadata: Dict[str, Any]
    processing_time: float


@router.post("/scrape", response_model=ScrapeResponse)
async def scrape_url(
    request: ScrapeRequest,
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser = Depends(get_current_user),
    scraper: ScraperService = Depends(get_scraper_service)
) -> ScrapeResponse:
    """
    Scrape content from a web URL.

    This endpoint fetches and extracts content from web pages,
    with options for text extraction and link discovery.
    """
    start_time = time.time()

    try:
        logger.info(f"Scraping URL: {request.url}")

        # Validate URL format
        if not request.url.startswith(('http://', 'https://')):
            raise ValidationError("URL must start with http:// or https://")

        # Scrape the URL
        result = await scraper.scrape_url(
            url=request.url,
            timeout=request.timeout,
            wait_for_selector=request.wait_for_selector,
            extract_text=request.extract_text,
            extract_links=request.extract_links
        )

        processing_time = time.time() - start_time

        logger.info(
            f"URL scraped successfully in {processing_time:.3f}s",
            extra={
                "url": request.url,
                "content_length": len(result.get('text_content', '')),
                "links_count": len(result.get('links', [])),
                "processing_time": processing_time
            }
        )

        return ScrapeResponse(
            url=request.url,
            title=result.get('title'),
            text_content=result.get('text_content') if request.extract_text else None,
            links=result.get('links') if request.extract_links else None,
            metadata=result.get('metadata', {}),
            processing_time=processing_time
        )

    except ValidationError as e:
        logger.warning(f"Validation error in scrape request: {e.message}")
        raise HTTPException(status_code=400, detail=e.message)
    except ExternalServiceError as e:
        logger.error(f"External service error during scraping: {e.message}")
        raise HTTPException(status_code=502, detail=e.message)
    except ProcessingError as e:
        logger.error(f"Processing error during scraping: {e.message}")
        raise HTTPException(status_code=422, detail=e.message)
    except Exception as e:
        logger.error(f"Unexpected error during scraping: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/pdf/parse", response_model=PDFParseResponse)
async def parse_pdf(
    background_tasks: BackgroundTasks,
    current_user: AuthenticatedUser = Depends(get_current_user),
    file: UploadFile = File(...),
    options: PDFParseRequest = Depends(),
    pdf_service: PDFService = Depends(get_pdf_service)
) -> PDFParseResponse:
    """
    Parse and extract content from a PDF file.

    This endpoint processes uploaded PDF files and extracts text content,
    with options for different extraction modes.
    """
    start_time = time.time()

    try:
        logger.info(f"Parsing PDF file: {file.filename}")

        # Validate file type
        if not file.content_type or 'pdf' not in file.content_type.lower():
            raise ValidationError("File must be a PDF")

        # Read file content
        content = await file.read()
        file_size = len(content)

        # Validate file size
        max_size = 50 * 1024 * 1024  # 50MB
        if file_size > max_size:
            raise ValidationError(f"File size ({file_size} bytes) exceeds maximum allowed size (50MB)")

        # Parse the PDF
        result = await pdf_service.parse_pdf(
            content=content,
            filename=file.filename or "unknown.pdf",
            extract_text=options.extract_text,
            extract_images=options.extract_images,
            extract_tables=options.extract_tables
        )

        processing_time = time.time() - start_time

        logger.info(
            f"PDF parsed successfully in {processing_time:.3f}s",
            extra={
                "filename": file.filename,
                "file_size": file_size,
                "content_length": len(result.get('text_content', '')),
                "processing_time": processing_time
            }
        )

        return PDFParseResponse(
            filename=file.filename or "unknown.pdf",
            content_type=file.content_type or "application/pdf",
            size_bytes=file_size,
            text_content=result.get('text_content') if options.extract_text else None,
            metadata=result.get('metadata', {}),
            processing_time=processing_time
        )

    except ValidationError as e:
        logger.warning(f"Validation error in PDF parsing: {e.message}")
        raise HTTPException(status_code=400, detail=e.message)
    except ProcessingError as e:
        logger.error(f"Processing error during PDF parsing: {e.message}")
        raise HTTPException(status_code=422, detail=e.message)
    except Exception as e:
        logger.error(f"Unexpected error during PDF parsing: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")