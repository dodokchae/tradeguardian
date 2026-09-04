from fastapi import APIRouter, HTTPException

from services.alpaca_service import (
    get_latest_price,
    get_market_bars,
    get_assets,
)

router = APIRouter(
    prefix="/market",
    tags=["Market"],
)

@router.get("/assets")
def get_available_assets():
    try:
        return get_assets()

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=f"Unable to retrieve Alpaca assets: {str(error)}",
        )


@router.get("/{symbol}")
def get_market_data(
    symbol: str,
    timeframe: str = "1M",
):
    symbol = symbol.upper()

    try:
        latest_price = round(
            get_latest_price(symbol),
            2,
        )

        bars = get_market_bars(
            symbol,
            timeframe,
        )

        return {
            "symbol": symbol,
            "latest_price": latest_price,
            "bars": bars,
        }

    except Exception as error:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unable to retrieve market data "
                f"for {symbol}: {str(error)}"
            ),
        )