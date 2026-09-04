from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from services.alpaca_service import get_positions
from agents.position_manager_agent import (
    scan_managed_positions,
    execute_position_exit,
    run_autonomous_position_manager,
)

router = APIRouter(
    prefix="/positions",
    tags=["Position Management & P&L"],
)


@router.get("/")
@router.get("")
def get_all_positions(response: Response):
    """
    Retrieve all open positions from Alpaca paper account.
    """
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    try:
        positions = get_positions()
        return [
            {
                "symbol": getattr(p, "symbol", ""),
                "qty": float(getattr(p, "qty", 0)),
                "entry_price": float(getattr(p, "avg_entry_price", 0)),
                "current_price": float(getattr(p, "current_price", 0)),
                "market_value": float(getattr(p, "market_value", 0)),
                "unrealized_pl": float(getattr(p, "unrealized_pl", 0)),
                "unrealized_plpc": float(getattr(p, "unrealized_plpc", 0)),
                "side": getattr(p, "side", ""),
                "asset_class": getattr(p, "asset_class", ""),
            }
            for p in (positions or [])
        ]
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve positions: {str(e)}",
        )


class ClosePositionRequest(BaseModel):
    symbol: str = Field(..., description="Position symbol or OCC option symbol to close")
    qty: Optional[float] = Field(default=None, description="Optional partial quantity to close")


class RunManagerRequest(BaseModel):
    auto_execute: bool = Field(default=False, description="Automatically submit exit orders if triggers are hit")


@router.get("/managed")
def get_managed_positions(response: Response):
    """
    Retrieve all open positions annotated with autonomous risk recommendations,
    P&L metrics, Greeks/DTE, and profit-target/stop-loss status.
    Guaranteed never to return 500 so UI panel always remains functional.
    """
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    try:
        positions = scan_managed_positions()
        total_pl = sum(getattr(p, "unrealized_pl", 0) for p in positions)
        return {
            "status": "success",
            "count": len(positions),
            "total_unrealized_pl": round(total_pl, 2),
            "positions": [p.model_dump() for p in positions],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        import logging
        logging.getLogger("TradeGuardian.PositionsRoute").error(f"Error in get_managed_positions: {e}")
        # Safe fallback so UI panel never crashes
        return {
            "status": "partial",
            "count": 0,
            "total_unrealized_pl": 0.0,
            "positions": [],
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


@router.post("/close")
async def close_single_position(payload: ClosePositionRequest):
    """
    Close an open option or stock position via Alpaca MCP Server / Trading API.
    """
    try:
        res = await execute_position_exit(payload.symbol, payload.qty)
        return res
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to close position {payload.symbol}: {str(e)}",
        )


@router.post("/manage-now")
async def trigger_position_management_cycle(payload: RunManagerRequest = RunManagerRequest()):
    """
    Trigger an autonomous position management cycle to evaluate take-profit,
    stop-loss, and expiration rules on all active holdings.
    """
    try:
        result = await run_autonomous_position_manager(auto_execute=payload.auto_execute)
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Position manager cycle failed: {str(e)}",
        )


@router.post("/cancel-order/{order_id}")
async def cancel_placed_order(order_id: str):
    """
    Cancel an open or pending order by ID from Positions Manager.
    """
    from routes.trade import cancel_trade_order
    return await cancel_trade_order(order_id)

