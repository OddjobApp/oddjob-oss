import asyncio
import os
import sys

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.ipc_service import ipc_service
from core.redis_client import close_redis_connection
from core.logging import setup_logging

import logging

logger = logging.getLogger(__name__)

async def main():
    setup_logging()
    
    try:
        await ipc_service.initialize()
        await ipc_service.start()
    except KeyboardInterrupt:
        logger.info("IPC Service stopping...")
    finally:
        await close_redis_connection()

if __name__ == "__main__":
    asyncio.run(main())
