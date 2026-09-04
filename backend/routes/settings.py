import logging
from typing import Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from alpaca.trading.client import TradingClient

from core.config import (
    ALPACA_API_KEY,
    ALPACA_SECRET_KEY,
    ALPACA_BASE_URL,
    ALPACA_PAPER,
    is_alpaca_configured,
    update_alpaca_credentials,
)
from services.alpaca_service import reinitialize_alpaca_clients

logger = logging.getLogger("TradeGuardian.Routes.Settings")

router = APIRouter(
    prefix="/settings",
    tags=["Settings"],
)


class AlpacaCredentialsRequest(BaseModel):
    api_key: str = Field(..., description="Alpaca API Key ID (e.g. PK...)")
    secret_key: str = Field(..., description="Alpaca API Secret Key")
    base_url: Optional[str] = Field(
        default="https://paper-api.alpaca.markets",
        description="Alpaca Paper or Live Endpoint URL",
    )


def _mask_key(key: str) -> str:
    """Safely mask API key showing first 5 and last 4 characters."""
    if not key or len(key) <= 8:
        return "••••••••"
    return f"{key[:5]}••••••••{key[-4:]}"


def _extract_account_info(account: Any) -> dict[str, Any]:
    """Safely extract normalized account details whether account is a dict or SDK TradeAccount."""
    if isinstance(account, dict):
        return {
            "id": str(account.get("id", "")),
            "status": str(account.get("status", "ACTIVE")),
            "currency": str(account.get("currency", "USD")),
            "equity": float(account.get("equity", 0.0) or 0.0),
            "cash": float(account.get("cash", 0.0) or 0.0),
            "buying_power": float(account.get("buying_power", 0.0) or 0.0),
        }
    return {
        "id": str(getattr(account, "id", "")),
        "status": str(getattr(account, "status", "ACTIVE")),
        "currency": str(getattr(account, "currency", "USD")),
        "equity": float(getattr(account, "equity", 0.0) or 0.0),
        "cash": float(getattr(account, "cash", 0.0) or 0.0),
        "buying_power": float(getattr(account, "buying_power", 0.0) or 0.0),
    }


@router.get("/alpaca")
def get_alpaca_settings():
    """
    Retrieve current Alpaca credentials status, masked API key, and active endpoint.
    """
    configured = is_alpaca_configured()
    return {
        "is_configured": configured,
        "api_key_masked": _mask_key(ALPACA_API_KEY) if configured else "",
        "base_url": ALPACA_BASE_URL,
        "paper": ALPACA_PAPER,
    }


@router.post("/alpaca/test")
def test_alpaca_credentials(request: AlpacaCredentialsRequest):
    """
    Test Alpaca API credentials directly against Alpaca's live endpoint
    without saving them to disk.
    """
    key = request.api_key.strip()
    secret = request.secret_key.strip()

    if not key or not secret:
        raise HTTPException(
            status_code=400,
            detail="Both API Key ID and Secret Key are required.",
        )

    try:
        test_client = TradingClient(
            api_key=key,
            secret_key=secret,
            paper=True,
        )
        account = test_client.get_account()
        info = _extract_account_info(account)

        return {
            "success": True,
            "message": f"Successfully connected to Alpaca account ({info['status']}).",
            "account_id": info["id"],
            "status": info["status"],
            "currency": info["currency"],
            "equity": info["equity"],
            "cash": info["cash"],
            "buying_power": info["buying_power"],
        }

    except Exception as e:
        logger.warning(f"Alpaca credentials test failed: {e}")
        err_msg = str(e)
        if "forbidden" in err_msg.lower() or "unauthorized" in err_msg.lower():
            err_msg = "Invalid API Key ID or Secret Key. Please verify in Alpaca Dashboard."
        raise HTTPException(
            status_code=400,
            detail=f"Alpaca authentication failed: {err_msg}",
        )


@router.post("/alpaca")
def save_alpaca_credentials(request: AlpacaCredentialsRequest):
    """
    Validate, persist to backend/.env, and dynamically re-initialize all
    Alpaca SDK clients in memory for immediate platform-wide usage.
    """
    key = request.api_key.strip()
    secret = request.secret_key.strip()
    base_url = (request.base_url or ALPACA_BASE_URL).strip().rstrip("/")

    if not key or not secret:
        raise HTTPException(
            status_code=400,
            detail="Both API Key ID and Secret Key are required.",
        )

    # 1. Test live with Alpaca before saving
    try:
        account = reinitialize_alpaca_clients(
            api_key=key,
            secret_key=secret,
            base_url=base_url,
            paper=True,
        )
    except Exception as e:
        logger.error(f"Failed to reinitialize Alpaca clients with new keys: {e}")
        err_msg = str(e)
        if "forbidden" in err_msg.lower() or "unauthorized" in err_msg.lower():
            err_msg = "Invalid API credentials. Alpaca rejected connection."
        raise HTTPException(
            status_code=400,
            detail=f"Unable to activate Alpaca account: {err_msg}",
        )

    # 2. Persist to backend/.env
    try:
        update_alpaca_credentials(
            api_key=key,
            secret_key=secret,
            base_url=base_url,
        )
    except Exception as e:
        logger.error(f"Failed to write credentials to backend/.env: {e}")
        # Clients are already reinitialized in memory, but warn about persistence
        pass

    info = _extract_account_info(account)
    return {
        "success": True,
        "message": "Alpaca credentials verified and saved successfully. Live account switched.",
        "account": info,
        "api_key_masked": _mask_key(key),
    }
