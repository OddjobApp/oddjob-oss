import os
import uvicorn
from fastapi import FastAPI

app = FastAPI(title="Oddjob Python Backend")

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "runtime": "python/fastapi",
        "message": "Oddjob Python/FastAPI Backend Service Operational"
    }

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
