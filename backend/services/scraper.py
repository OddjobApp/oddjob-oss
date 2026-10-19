
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import asyncio

async def scrape_url(url: str):
    print(f"[Scraper] Scraping {url}...")
    async with async_playwright() as p:
        # Launch browser (headless)
        browser = await p.chromium.launch(headless=True)
        
        # New context with user agent to avoid basic blocking
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        )
        page = await context.new_page()
        
        try:
            # Navigate
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            
            # Get content
            content = await page.content()
            
            # Basic parsing
            soup = BeautifulSoup(content, 'html.parser')
            
            # Remove scripts and styles
            for script in soup(["script", "style"]):
                script.decompose()
                
            text = soup.get_text(separator=' ', strip=True)
            title = soup.title.string if soup.title else ""
            
            return {
                "url": url,
                "title": title,
                "text": text[:10000], # Limit return size
                "html_snippet": str(soup)[:2000] # Debug snippet
            }
        except Exception as e:
            print(f"[Scraper] Error: {e}")
            return {"error": str(e)}
        finally:
            await browser.close()
