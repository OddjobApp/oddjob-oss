
import asyncio
import json
import os
import hmac
import hashlib
import redis.asyncio as redis
from dotenv import load_dotenv
import google.generativeai as genai
import ollama

load_dotenv()

# Configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
MOLT_SECRET = os.getenv("MOLT_SECRET", "dev_secret_key_change_in_prod")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

class AsyncDispatcher:
    def __init__(self):
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)
        # Tracking last processed ID for each session to implement "Differential Context" logic later
        self.session_cursors = {} 

    def verify_signature(self, payload_str, signature):
        if not signature:
            return False
        expected = hmac.new(
            MOLT_SECRET.encode('utf-8'), 
            payload_str.encode('utf-8'), 
            hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature)

    async def run(self):
        print("[AsyncDispatcher] Starting OODA Loop Listener...")
        # Start Heartbeat Task
        asyncio.create_task(self.heartbeat_loop())
        
        while True:
            try:
                # Active approach: Scan for keys matching 'oddjob:stream:molt:*'
                stream_keys = await self.redis.keys("oddjob:stream:molt:*")
                
                if not stream_keys:
                    await asyncio.sleep(1)
                    continue

                for key in stream_keys:
                    session_id = key.split(":")[-1]
                    last_id = self.session_cursors.get(session_id, "$") # Use $ only for first start? Or 0? $ means new only.

                    # Use XREAD to get new messages
                    # Count 1 to process one by one
                    streams = {key: last_id}
                    response = await self.redis.xread(streams, count=1, block=100)
                    
                    if not response:
                        continue

                    for stream_name, messages in response:
                        for message_id, fields in messages:
                            # Update cursor
                            self.session_cursors[session_id] = message_id
                            
                            # fields is a dict in python redis client usually? or list?
                            # decode_responses=True means strings.
                            # redis-py returns fields as a dict if using standard client?
                            # checking redis-py logic. It usually returns {b'key': b'value'} or {'key': 'value'}
                            
                            # If fields is a dict:
                            data = fields
                            
                            type_ = data.get('type')
                            payload_str = data.get('payload')
                            signature = data.get('signature')

                            if not payload_str:
                                continue

                            # Verify Signature
                            if not self.verify_signature(payload_str, signature):
                                print(f"[AsyncDispatcher] Invalid signature for {message_id}. Ignoring.")
                                continue

                            try:
                                payload = json.loads(payload_str)
                            except json.JSONDecodeError:
                                print(f"[AsyncDispatcher] Invalid JSON in {message_id}")
                                continue

                            if type_ == 'PROPOSAL':
                                print(f"[AsyncDispatcher] Processing PROPOSAL {message_id}")
                                # ... dispatch logic ...
                                # For POC, we just simulate a vote back
                                asyncio.create_task(self.dispatch_tasks(session_id, message_id, payload))
            
            except Exception as e:
                print(f"[AsyncDispatcher] Error: {e}")
                await asyncio.sleep(1)

    async def heartbeat_loop(self):
        print("[AsyncDispatcher] Starting Heartbeat Loop...")
        while True:
            try:
                heartbeat_data = {
                    "timestamp": int(asyncio.get_event_loop().time() * 1000),
                    "status": "HEALTHY",
                    "windows": ["W-1", "W-2", "W-3", "W-4"]
                }
                # Set heartbeat with 30s TTL
                await self.redis.set(
                    "oddjob:governor:dispatcher:heartbeat", 
                    json.dumps(heartbeat_data),
                    ex=30
                )
            except Exception as e:
                print(f"[AsyncDispatcher] Heartbeat Error: {e}")
            await asyncio.sleep(10)

    def sign(self, payload_str):
        return hmac.new(
            MOLT_SECRET.encode('utf-8'), 
            payload_str.encode('utf-8'), 
            hashlib.sha256
        ).hexdigest()

    async def dispatch_tasks(self, session_id, proposal_id, payload):
        command = payload.get('command')
        
        # Phase 1: Stub outputs for W-1 (Strategist), W-2 (Critic), W-3 (Explorer), W-4 (Auditor)
        tasks = [
            self.agent_task("W-1", "gemini-pro", command, "Strategist", "You are the Strategist. Analyze the happy path."),
            self.agent_task("W-2", "phi3", command, "Critic", "You are the Critic. Veto if unsafe."),
            self.agent_task("W-3", "llama3", command, "Explorer", "You are the Explorer. Suggest alternatives."),
            self.agent_task("W-4", "gemini-pro", command, "Auditor", "You are the Auditor. Check historical precedents.")
        ]

        results = await asyncio.gather(*tasks)

        stream_name = f"oddjob:stream:molt:{session_id}"

        # Publish VOTES back to stream
        for agent_role, confidence, reasoning in results:
            vote_payload = {
                'proposalId': proposal_id,
                'agent': agent_role,
                'confidence': confidence,
                'reasoning': reasoning
            }
            
            await self.redis.xadd(
                stream_name,
                {'type': 'VOTE', 'payload': json.dumps(vote_payload), 'timestamp': str(int(asyncio.get_event_loop().time() * 1000))}
            )
            print(f"[AsyncDispatcher] Published VOTE from {agent_role} for {proposal_id}")

    async def call_gemini(self, prompt: str):
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = await model.generate_content_async(prompt)
        return response.text

    async def call_ollama(self, model: str, prompt: str):
        response = ollama.generate(model=model, prompt=prompt)
        return response['response']

    async def agent_task(self, role: str, model: str, command: str, persona: str, prompt: str):
        full_prompt = f"Role: {persona}\n{prompt}\n\nStrategic Command for Evaluation: {command}\n\nTASK: Evaluate the safety and efficacy of this command. Provide a Confidence Score (0.0-1.0) and a brief reasoning in JSON format: {{'confidence': float, 'reasoning': string}}"
        
        try:
            if model.startswith("gemini") and GEMINI_API_KEY:
                raw_response = await self.call_gemini(full_prompt)
            else:
                raw_response = await self.call_ollama(model if not model.startswith("gemini") else "llama3", full_prompt)
            
            # Extract JSON from response
            try:
                # Basic cleaning for rogue markdown markers
                clean_json = raw_response.strip().replace("```json", "").replace("```", "").strip()
                result = json.loads(clean_json)
                return (role, float(result.get('confidence', 0.5)), result.get('reasoning', "No reasoning provided"))
            except:
                # Fallback if AI fails to return JSON
                return (role, 0.5, f"Manual parse failed. Raw: {raw_response[:100]}")
            
        except Exception as e:
            print(f"[AsyncDispatcher] Error in {role} ({model}): {e}")
            return (role, 0.0, f"Error: {str(e)}")

if __name__ == "__main__":
    dispatcher = AsyncDispatcher()
    loop = asyncio.get_event_loop()
    try:
        loop.run_until_complete(dispatcher.run())
    except KeyboardInterrupt:
        pass
