from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List

from services.alpaca_service import (
    get_assets,
    get_latest_price,
    fetch_snapshots_for_symbols,
    get_asset_name,
    _SNAPSHOT_CACHE,
)


router = APIRouter(
    prefix="/assets",
    tags=["Assets"],
)


class SnapshotBatchRequest(BaseModel):
    symbols: List[str]


@router.get("")
@router.get("/")
def get_available_assets():
    try:
        return get_assets()

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unable to retrieve Alpaca assets: "
                f"{str(error)}"
            ),
        )


@router.post("/snapshots")
def get_batch_snapshots(payload: SnapshotBatchRequest):
    """Fetch live prices and 24h changes on-demand for a list of symbols from Alpaca."""
    try:
        if not payload.symbols:
            return {}
        syms = payload.symbols[:50]
        results = fetch_snapshots_for_symbols(syms)
        return results
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to retrieve live snapshots: {str(error)}",
        )


@router.get("/price/{symbol}")
def get_asset_live_price(symbol: str):
    """Fetch 100% accurate, real-time live price and 24h change for any market asset from Alpaca."""
    try:
        clean = symbol.replace('-', '/').upper()
        price = get_latest_price(clean)

        # Retrieve real-time 24h change from snapshot cache if available
        change = "0.00%"
        cached = _SNAPSHOT_CACHE.get(clean) or _SNAPSHOT_CACHE.get(clean.replace("/", ""))
        if not cached or not cached.get("change") or cached.get("change") == "0.00%":
            snaps = fetch_snapshots_for_symbols([clean])
            cached = snaps.get(clean) or snaps.get(clean.replace("/", "")) or cached

        if cached and cached.get("change"):
            change = cached["change"]

        # Preserve sub-dollar precision for crypto / penny assets
        if price < 0.0001:
            price_rounded = round(price, 6)
        elif price < 0.01:
            price_rounded = round(price, 5)
        elif price < 1.0:
            price_rounded = round(price, 4)
        elif price < 10.0:
            price_rounded = round(price, 3)
        else:
            price_rounded = round(price, 2)

        return {
            "symbol": clean,
            "name": get_asset_name(clean),
            "price": price_rounded,
            "change": change,
        }
    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to retrieve live price for {symbol}: {str(error)}",
        )