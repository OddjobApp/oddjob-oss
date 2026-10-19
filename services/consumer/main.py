
import os
import time
import json
import logging
import threading
import pika
import redis
import numpy as np
import psycopg2
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File
from pydantic import BaseModel
import uvicorn
import requests
from bs4 import BeautifulSoup
import PyPDF2
import io
import sys
from io import StringIO
import contextlib

from inference import BayesianInferenceEngine
from synthesizer import ContextSynthesizer
from distillation import KnowledgeDistiller

# --- Configuration ---
RABBIT_URL = os.getenv('RABBIT_URL', 'amqp://guest:guest@localhost:5672')
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379')
QUEUE_NAME = 'intent.raw'
REDIS_PREFIX = 'score_v1:'
PORT = int(os.getenv('PORT', 8001))

# --- Logging ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('ConsumerService')

# --- FastAPI App ---
app = FastAPI(title="Oddjob Python Sidecar")

# --- Models ---
class ExecuteRequest(BaseModel):
    script: str
    input_data: Any

class ExecuteResponse(BaseModel):
    result: Any
    logs: str

class ScrapeRequest(BaseModel):
    url: str

class EmbedRequest(BaseModel):
    text: str

class DistillRequest(BaseModel):
    text: str

# --- Legacy Consumer Class (Wrapped) ---
class ScoringConsumer:
    def __init__(self):
        self.engine = BayesianInferenceEngine()
        self.synthesizer = ContextSynthesizer()
        self.distiller = KnowledgeDistiller()
        self.redis_client = None
        self.rabbit_conn = None
        self.channel = None
        self._stop_event = threading.Event()

    def connect(self):
        # Connect to Redis
        try:
            self.redis_client = redis.from_url(REDIS_URL, decode_responses=True)
            self.synthesizer.redis_client = self.redis_client 
            logger.info("[Redis] Connected")
        except Exception as e:
            logger.error(f"[Redis] Connection failed: {e}")
            # Don't raise, just retry later or fail gracefully
            
        # Connect to RabbitMQ
        while not self._stop_event.is_set():
            try:
                params = pika.URLParameters(RABBIT_URL)
                self.rabbit_conn = pika.BlockingConnection(params)
                self.channel = self.rabbit_conn.channel()
                self.channel.queue_declare(
                    queue=QUEUE_NAME, 
                    durable=False,
                    arguments={'x-message-ttl': 60000} 
                )
                logger.info("[RabbitMQ] Connected and Queue Asserted")
                return
            except Exception as e:
                logger.error(f"[RabbitMQ] Connection failed: {e}. Retrying in 5s...")
                time.sleep(5)

    def get_user_belief(self, user_id):
        key = f"{REDIS_PREFIX}{user_id}"
        if self.redis_client:
            data = self.redis_client.get(key)
            if data:
                return np.array(json.loads(data))
        return self.engine.get_initial_belief()

    def save_user_belief(self, user_id, belief_vector):
        if self.redis_client:
            key = f"{REDIS_PREFIX}{user_id}"
            json_data = json.dumps(belief_vector.tolist())
            self.redis_client.setex(key, 172800, json_data)

    def process_message(self, ch, method, properties, body):
        try:
            pulse = json.loads(body)
            # ... process logic ...
            # Simplified for brevity in this hybrid File - keeping core logic
            user_id = pulse.get('f_id', 'anonymous')
            vector = pulse.get('vector')
            intensity = pulse.get('intensity', 1.0)
            
            # Logic from original file (abbreviated)
            current_belief = self.get_user_belief(user_id)
            if vector:
                new_belief = self.engine.update_belief(current_belief, vector, intensity)
            else:
                new_belief = current_belief 

            state, confidence = self.engine.get_dominant_state(new_belief)
            self.save_user_belief(user_id, new_belief)
            
            logger.info(f"[Update] User: {user_id[-6:]} | State: {state} ({confidence:.2f})")
            
            ch.basic_ack(delivery_tag=method.delivery_tag)
            
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

    def run(self):
        logger.info("Starting Consumer Thread...")
        self.connect()
        if self.channel:
            self.channel.basic_qos(prefetch_count=10)
            self.channel.basic_consume(queue=QUEUE_NAME, on_message_callback=self.process_message)
            logger.info(" [*] Consumer Waiting for pulses.")
            try:
                self.channel.start_consuming()
            except Exception as e:
                logger.error(f"Consumer stopped: {e}")

# --- Global Consumer Instance ---
consumer_thread = None

@app.on_event("startup")
async def startup_event():
    global consumer_thread
    consumer = ScoringConsumer()
    consumer_thread = threading.Thread(target=consumer.run, daemon=True)
    consumer_thread.start()

# --- Endpoints ---

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/execute")
async def execute_script(req: ExecuteRequest):
    """
    Executes a Python script in a restricted environment.
    IMPORTANT: Enforces static safety checks and strips dynamic imports.
    """
    logger.info("Executing custom script...")
    
    # Prevent sandbox escapes
    blocked_keywords = ["os", "sys", "subprocess", "socket", "eval", "exec", "getattr", "__subclasses__", "__globals__"]
    for keyword in blocked_keywords:
        if keyword in req.script:
            raise HTTPException(status_code=400, detail=f"Security Exception: Blocked keyword '{keyword}' found in script")

    # Capture stdout
    old_stdout = sys.stdout
    redirected_output = sys.stdout = StringIO()

    # Secure builtins to prevent dynamic imports
    secure_builtins = __builtins__.copy() if isinstance(__builtins__, dict) else __builtins__.__dict__.copy()
    secure_builtins['__import__'] = lambda *args, **kwargs: None

    # Restricted globals
    safe_globals = {
        "__builtins__": secure_builtins,
        "json": json,
        "math": __import__('math'),
        "datetime": __import__('datetime'),
        "input_data": req.input_data,
        "result": None # Output variable
    }

    try:
        # Exec the script
        exec(req.script, safe_globals)
        
        # Get result
        result = safe_globals.get('result')
        
        # Get logs
        logs = redirected_output.getvalue()
        
        return {"result": result, "logs": logs}
        
    except Exception as e:
        logger.error(f"Script execution failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        sys.stdout = old_stdout

@app.post("/scrape")
async def scrape_url(req: ScrapeRequest):
    # Egress Firewall check
    from urllib.parse import urlparse
    try:
        parsed_url = urlparse(req.url)
        hostname = parsed_url.hostname.lower() if parsed_url.hostname else ""
        blocked_hosts = ["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "::1"]
        if hostname in blocked_hosts or hostname.endswith(".local") or hostname.endswith(".internal"):
            raise HTTPException(status_code=400, detail="Access to local network and metadata interfaces is blocked.")
            
        if (
            hostname.startswith("10.") or
            hostname.startsWith("192.168.") or
            hostname.startswith("172.16.") or
            hostname.startswith("172.17.") or
            hostname.startswith("172.18.") or
            hostname.startsWith("172.19.") or
            hostname.startsWith("172.2") or
            hostname.startsWith("172.3")
        ):
            raise HTTPException(status_code=400, detail="Access to private subnet ranges is blocked.")
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=400, detail="Invalid URL format.")

    try:
        res = requests.get(req.url, timeout=10)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, 'html.parser')
        
        title = soup.title.string if soup.title else ""
        text = soup.get_text(separator=' ', strip=True)[:5000] # Limit text
        
        return {
            "url": req.url,
            "title": title,
            "text": text,
            "html_snippet": str(soup)[:1000]
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/parse-pdf")
async def parse_pdf(file: UploadFile = File(...)):
    try:
        content = await file.read()
        pdf_file = io.BytesIO(content)
        reader = PyPDF2.PdfReader(pdf_file)
        
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
            
        return {
            "text": text[:10000], # Limit return size
            "metadata": {
                "pages": len(reader.pages)
            }
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/embed")
async def embed_text(req: EmbedRequest):
    # Mock embedding for now (or use lightweight model if needed)
    # Returns random 1536-dim vector to simulate OpenAI/Cohere
    return {"embedding": np.random.rand(1536).tolist()}

@app.post("/distill")
async def distill_text(req: DistillRequest):
    # Use the global consumer instance's distiller if available, or create new one
    # For now, just create new one or use a global singleton if performance matters.
    # But since we initialized it in ScoringConsumer, and that runs in a thread...
    # Let's just create a quick instance here or access it via the global consumer object?
    # The consumer object is inside `startup_event` local scope but `consumer_thread` is global.
    # Accessing the instance from the thread target is tricky.
    # Let's just instantiate a dedicated distiller for API use to be safe and simple.
    
    distiller = KnowledgeDistiller()
    result = distiller.distill(req.text)
    return result

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
