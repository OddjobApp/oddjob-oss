"""
Scraper Service
Business logic for web scraping and content extraction
"""

import asyncio
from typing import Dict, Any, Optional
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

from core.config import settings
from core.exceptions import ValidationError, ProcessingError, ExternalServiceError
from core.logging import get_logger

logger = get_logger(__name__)


class ScraperService:
    """Service for web scraping and content extraction."""

    def __init__(self):
        self.timeout = settings.REQUEST_TIMEOUT
        self.user_agent = settings.USER_AGENT
        self.max_concurrent = settings.MAX_CONCURRENT_REQUESTS

    async def scrape_url(
        self,
        url: str,
        timeout: Optional[int] = None,
        wait_for_selector: Optional[str] = None,
        extract_text: bool = True,
        extract_links: bool = False
    ) -> Dict[str, Any]:
        """
        Scrape content from a URL using Playwright for JS support and paywall resilience.
        """
        from playwright.async_api import async_playwright
        request_timeout = (timeout or self.timeout) * 1000 # Convert to ms for playwright

        try:
            logger.info(f"Starting Playwright scrape of URL: {url}")

            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                context = await browser.new_context(
                    user_agent=self.user_agent,
                    viewport={'width': 1280, 'height': 800}
                )
                page = await context.new_page()
                
                try:
                    # Navigate and wait for content
                    response = await page.goto(url, wait_until="networkidle", timeout=request_timeout)
                    
                    if not response or response.status < 200 or response.status >= 300:
                        status = response.status if response else 0
                        raise ExternalServiceError(f"HTTP {status}", "web_scraper", {"status_code": status, "url": url})

                    # Optional: wait for selector
                    if wait_for_selector:
                        await page.wait_for_selector(wait_for_selector, timeout=10000)

                    # Specialized cleanup for Wired.com and similar paywalls
                    if "wired.com" in url:
                        logger.info("[Scraper] Applying Wired.com specific cleanup...")
                        try:
                            # Hide paywall overlays
                            await page.evaluate("""() => {
                                const selectors = [
                                    '.paywall-bar', 
                                    '.paywall-overlay', 
                                    '#one-trust-banner-container', 
                                    '.cookie-banner',
                                    '[id^="sp_message_container"]'
                                ];
                                selectors.forEach(s => {
                                    document.querySelectorAll(s).forEach(el => el.style.display = 'none');
                                });
                                document.body.style.overflow = 'auto';
                            }""")
                        except Exception as e:
                            logger.warn(f"[Scraper] Wired cleanup failed (non-fatal): {e}")

                    # Get content after JS execution
                    html_content = await page.content()
                    final_url = page.url
                    title = await page.title()

                    # Parse HTML with BeautifulSoup for cleaner text extraction
                    soup = BeautifulSoup(html_content, 'html.parser')

                    result: Dict[str, Any] = {
                        "metadata": {
                            "status_code": response.status,
                            "content_type": "text/html",
                            "content_length": len(html_content),
                            "url": final_url,
                            "response_time": 0 # Estimated
                        },
                        "title": title
                    }

                    # Extract text content
                    if extract_text:
                        result["text_content"] = self._extract_text_content(soup)

                    # Extract links
                    if extract_links:
                        result["links"] = self._extract_links(soup, url)

                    logger.info(f"Successfully scraped URL with Playwright: {url}")
                    return result

                finally:
                    await browser.close()

        except Exception as e:
            logger.error(f"Playwright scraping failed for {url}: {str(e)}", exc_info=True)
            if "timeout" in str(e).lower():
                raise ExternalServiceError("Request timeout", "web_scraper", {"url": url})
            raise ProcessingError(f"Scraping failed: {str(e)}", "web_scraping")

    def _extract_text_content(self, soup: BeautifulSoup) -> str:
        """Extract readable text content from HTML."""
        # Remove script and style elements
        for element in soup(["script", "style", "nav", "footer", "header", "aside"]):
            element.decompose()

        # Get text and clean it up
        text = soup.get_text(separator='\n', strip=True)

        # Clean up excessive whitespace
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        return '\n'.join(lines)

    def _extract_links(self, soup: BeautifulSoup, base_url: str) -> list[str]:
        """Extract all links from HTML."""
        links = []
        base_parsed = urlparse(base_url)

        for a_tag in soup.find_all('a', href=True):
            href = a_tag.get('href')
            if href:
                absolute_url = urljoin(base_url, str(href))

                # Only include links from the same domain
                link_parsed = urlparse(absolute_url)
                if link_parsed.netloc == base_parsed.netloc:
                    links.append(absolute_url)

        return list(set(links))  # Remove duplicates