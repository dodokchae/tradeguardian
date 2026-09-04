from fastapi import APIRouter, HTTPException

from services.alpaca_service import get_account, get_positions


router = APIRouter(
    prefix="/portfolio",
    tags=["Portfolio"],
)


@router.get("/")
def read_portfolio():
    try:
        account = get_account()
        positions = get_positions()

        formatted_positions = []

        for position in positions:
            formatted_positions.append(
                {
                    "symbol": position.symbol,
                    "quantity": str(position.qty),
                    "market_value": str(position.market_value),
                    "average_entry_price": str(position.avg_entry_price),
                    "current_price": str(position.current_price),
                    "unrealized_pl": str(position.unrealized_pl),
                    "unrealized_pl_percent": str(
                        position.unrealized_plpc
                    ),
                }
            )

        return {
            "account": {
                "cash": str(account.cash),
                "equity": str(account.equity),
                "buying_power": str(account.buying_power),
            },
            "positions": formatted_positions,
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve portfolio: {str(error)}",
        )


@router.get("/history")
def read_portfolio_history(period: str = "1D"):
    """Fetch mark-to-market portfolio history from Alpaca API."""
    import requests
    from core.config import settings

    try:
        url = f"{settings.ALPACA_BASE_URL}/v2/account/portfolio/history"
        tf_map = {
            "1D": "15Min",
            "1W": "1H",
            "1M": "1D",
            "ALL": "1D",
        }
        alpaca_period = "all" if period == "ALL" else period
        timeframe = tf_map.get(period, "15Min")

        headers = {
            "APCA-API-KEY-ID": settings.ALPACA_API_KEY,
            "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY,
        }
        params = {
            "period": alpaca_period,
            "timeframe": timeframe,
            "intraday_reporting": "market_hours",
        }
        res = requests.get(url, headers=headers, params=params, timeout=8)
        if res.ok:
            return res.json()
        return {"error": res.text, "status_code": res.status_code}
    except Exception as error:
        return {"error": str(error)}