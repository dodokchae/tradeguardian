import logging
import os
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger("TradeGuardian.Config")

# Base directory for backend
BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent

# Load environment files: root first, then backend/.env to override
root_env = ROOT_DIR / ".env"
backend_env = BACKEND_DIR / ".env"

if root_env.exists():
    load_dotenv(dotenv_path=root_env, override=False)

if backend_env.exists():
    load_dotenv(dotenv_path=backend_env, override=True)
else:
    load_dotenv(override=False)

# Alpaca Credentials & Endpoints (whitespace-stripped)
ALPACA_API_KEY: str = os.getenv("ALPACA_API_KEY", "").strip()
ALPACA_SECRET_KEY: str = os.getenv("ALPACA_SECRET_KEY", "").strip()
ALPACA_BASE_URL: str = os.getenv(
    "ALPACA_BASE_URL",
    "https://paper-api.alpaca.markets",
).strip().rstrip("/")
ALPACA_DATA_URL: str = os.getenv(
    "ALPACA_DATA_URL",
    "https://data.alpaca.markets",
).strip().rstrip("/")

# Paper trading flag
ALPACA_PAPER: bool = os.getenv("ALPACA_PAPER", "true").lower() in ("true", "1", "yes")

# Database configuration
_env_db = os.getenv("DATABASE_PATH")
if _env_db:
    DATABASE_PATH: Path = Path(_env_db)
elif (BACKEND_DIR / "tradeguardian.db").exists():
    DATABASE_PATH: Path = BACKEND_DIR / "tradeguardian.db"
else:
    DATABASE_PATH: Path = BACKEND_DIR / "data" / "tradeguardian.db"

# Server configuration
PORT: int = int(os.getenv("PORT", "8000"))
HOST: str = os.getenv("HOST", "0.0.0.0")
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()

# CORS allowed origins
DEFAULT_ORIGINS = [
    "https://supreme-fortnight-g47pp96xvg7xh9wr-3000.app.github.dev",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
custom_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
CORS_ORIGINS: list[str] = custom_origins if custom_origins else DEFAULT_ORIGINS


def is_alpaca_configured() -> bool:
    """Return True if valid Alpaca API credentials appear to be provided."""
    return bool(
        ALPACA_API_KEY
        and ALPACA_SECRET_KEY
        and not ALPACA_API_KEY.startswith("your_")
        and not ALPACA_SECRET_KEY.startswith("your_")
    )


if not is_alpaca_configured():
    logger.warning(
        "Alpaca API credentials not configured or incomplete in .env. "
        "Trading and market data features may operate in degraded mode."
    )


def update_alpaca_credentials(api_key: str, secret_key: str, base_url: str | None = None) -> None:
    """
    Update Alpaca API credentials in-memory and write them to backend/.env.
    """
    global ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_BASE_URL

    clean_key = api_key.strip()
    clean_secret = secret_key.strip()
    clean_url = (base_url or ALPACA_BASE_URL).strip().rstrip("/")

    # Update in-memory globals
    ALPACA_API_KEY = clean_key
    ALPACA_SECRET_KEY = clean_secret
    ALPACA_BASE_URL = clean_url

    # Update os.environ
    os.environ["ALPACA_API_KEY"] = clean_key
    os.environ["ALPACA_SECRET_KEY"] = clean_secret
    os.environ["ALPACA_BASE_URL"] = clean_url
    os.environ["APCA_API_KEY_ID"] = clean_key
    os.environ["APCA_API_SECRET_KEY"] = clean_secret

    # Write to backend/.env safely
    env_file = BACKEND_DIR / ".env"
    existing_lines: list[str] = []
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            existing_lines = f.readlines()

    keys_written = {"ALPACA_API_KEY": False, "ALPACA_SECRET_KEY": False, "ALPACA_BASE_URL": False}
    new_lines: list[str] = []

    for line in existing_lines:
        stripped = line.strip()
        if stripped.startswith("ALPACA_API_KEY="):
            new_lines.append(f"ALPACA_API_KEY={clean_key}\n")
            keys_written["ALPACA_API_KEY"] = True
        elif stripped.startswith("ALPACA_SECRET_KEY="):
            new_lines.append(f"ALPACA_SECRET_KEY={clean_secret}\n")
            keys_written["ALPACA_SECRET_KEY"] = True
        elif stripped.startswith("ALPACA_BASE_URL="):
            new_lines.append(f"ALPACA_BASE_URL={clean_url}\n")
            keys_written["ALPACA_BASE_URL"] = True
        else:
            new_lines.append(line)

    if not keys_written["ALPACA_API_KEY"]:
        new_lines.append(f"ALPACA_API_KEY={clean_key}\n")
    if not keys_written["ALPACA_SECRET_KEY"]:
        new_lines.append(f"ALPACA_SECRET_KEY={clean_secret}\n")
    if not keys_written["ALPACA_BASE_URL"]:
        new_lines.append(f"ALPACA_BASE_URL={clean_url}\n")

    with open(env_file, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

    logger.info("Successfully persisted new Alpaca credentials to backend/.env")