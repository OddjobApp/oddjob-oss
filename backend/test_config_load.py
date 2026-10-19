import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from core.config import settings

print(f"Loaded JWT_SECRET_KEY: {settings.JWT_SECRET_KEY[:5]}...")
