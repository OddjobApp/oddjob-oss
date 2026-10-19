# Backend Services

This directory contains Python-based background services for the Oddjob application.

## Services

### Scheduler (`scheduler.py`)
Background service that polls the database for scheduled jobs and queues them for execution when their schedule time arrives.

**Features:**
- Polls every 60 seconds for due scheduled jobs
- Supports Daily, Weekly, Monthly, and Custom Cron patterns
- Manages run locks to prevent concurrent execution
- Queues jobs to the `work_queue` table
- Creates alerts on failures

**To run:**
```bash
cd backend
python scheduler.py
```

### Runner (`runner.py`)
Background service that processes jobs from the work queue and executes them.

**Features:**
- Polls every 5 seconds for ready jobs
- Supports multiple job types:
  - AI API calls (OpenAI, Anthropic, Google)
  - API/CURL requests
  - Shell commands
  - Python scripts
- Leases jobs to prevent duplicate execution
- Handles errors and creates alerts

**To run:**
```bash
cd backend
python runner.py
```

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set environment variables:
```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/oddjob"
```

3. Run services:
```bash
# Terminal 1: Scheduler
python scheduler.py

# Terminal 2: Runner
python runner.py
```

## Dependencies

- `asyncpg` - PostgreSQL async driver
- `croniter` - Cron expression parsing
- `httpx` - HTTP client for API jobs
- `openai` - OpenAI API client
- `anthropic` - Anthropic API client
- `python-dotenv` - Environment variable management

