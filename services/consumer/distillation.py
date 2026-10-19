
import logging
import json
from typing import Dict, Any, Optional

# Configure logging
logger = logging.getLogger('KnowledgeDistiller')

class KnowledgeDistiller:
    def __init__(self):
        self.translator = None
        self._init_translator()

    def _init_translator(self):
        try:
            from deep_translator import GoogleTranslator
            self.translator = GoogleTranslator(source='auto', target='en')
            logger.info("Deep Translator initialized successfully")
        except ImportError:
            logger.warning("deep-translator not found. Translation will be disabled.")
        except Exception as e:
            logger.error(f"Failed to initialize translator: {e}")

    def detect_language(self, text: str) -> str:
        try:
            from langdetect import detect
            return detect(text)
        except ImportError:
            logger.warning("langdetect not found. Defaulting to 'en'.")
            return 'en'
        except Exception as e:
            logger.error(f"Language detection failed: {e}")
            return 'unknown'

    def translate(self, text: str) -> str:
        if not self.translator:
            return text
        
        try:
            # Split text if it's too long (Google Translator has limits)
            # Simple chunking by 4000 chars
            if len(text) > 4000:
                chunks = [text[i:i+4000] for i in range(0, len(text), 4000)]
                translated_chunks = [self.translator.translate(chunk) for chunk in chunks]
                return " ".join(translated_chunks)
            
            return self.translator.translate(text)
        except Exception as e:
            logger.error(f"Translation failed: {e}")
            return text

    def distill(self, text: str) -> Dict[str, Any]:
        """
        Process text: identify language, translate if necessary, and summarize.
        """
        original_language = self.detect_language(text)
        translated_text = text

        if original_language != 'en':
            logger.info(f"Detected language {original_language}, translating to en...")
            translated_text = self.translate(text)
        
        # Basic summarization (first 3 sentences or 500 chars)
        # In a real scenario, we might use a local LLM or another service
        summary = translated_text[:500] + "..." if len(translated_text) > 500 else translated_text

        return {
            "original_language": original_language,
            "translated_text": translated_text,
            "summary": summary,
            "char_count": len(text)
        }
