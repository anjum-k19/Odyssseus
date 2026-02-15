"""Configuration from environment."""
import os
from functools import lru_cache
import dotenv

dotenv.load_dotenv()

@lru_cache
def get_config():
    return {
        "valkey_url": os.getenv("VALKEY_URL", "redis://localhost:6379"),
        "gemini_api_key": os.getenv("GEMINI_API_KEY", ""),
        "gemini_model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        "twelve_labs_api_key": os.getenv("TWELVE_LABS_API_KEY", ""),
    }
