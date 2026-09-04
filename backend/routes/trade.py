import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional, Union
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.database import get_connection
from models.trade import TradeProposal
from models.decision import AnalysisResult
from services.mcp_service import mcp_place_option_order, mcp_place_stock_order, mcp_cancel_order, log_agent_action
from services.alpaca_service import submit_option_order, get_orders, cancel_order, get_account

logger = logging.getLogger("TradeGuardian.Trade")

router = APIRouter(
    prefix="/trade",
    tags=["Trade Execution"],
)


class ExecuteTradeRequest(BaseModel):
    symbol: str = Field(..., description="Underlying stock symbol, e.g. AAPL")
    option_symbol: Optional[str] = Field(default=None, description="OCC Option contract symbol (optional for stocks)")
    side: str = Field(default="buy", description="'buy' or 'sell'")
    quantity: Union[int, float] = Field(default=1.0, gt=0, description="Contract or share quantity")
    order_type: str = Field(default="market", description="'market' or 'limit'")
    limit_price: Optional[float] = Field(default=None, description="Limit price per share if limit order")
    source: str = Field(default="GuardianAgent", description="Source agent approving the trade")
    strategy: Optional[str] = Field(default="Options Alpha Agent", description="Options strategy name")


def record_order_in_db(order_dict: dict[str, Any], symbol: str, option_symbol: Optional[str], side: str, qty: Union[int, float], order_type: str, limit_price: Optional[float]):
    """Persist order metadata into SQLite trade_orders."""
    try:
        conn = get_connection()
        order_id = str(order_dict.get("id") or order_dict.get("order_id") or uuid4())
        client_order_id = str(order_dict.get("client_order_id", ""))
        status = str(order_dict.get("status", "accepted"))
        filled_avg_price = order_dict.get("filled_avg_price")
        filled_qty = order_dict.get("filled_qty", 0)
        submitted_at = str(order_dict.get("submitted_at") or datetime.now(timezone.utc).isoformat())

        conn.execute(
            """
            INSERT OR REPLACE INTO trade_orders (
                order_id, client_order_id, symbol, option_symbol, side,
                quantity, order_type, limit_price, status,
                filled_avg_price, filled_qty, submitted_at, raw_response
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                order_id,
                client_order_id,
                symbol.upper(),
                option_symbol.upper() if option_symbol else None,
                side.upper(),
                float(qty),
                order_type.upper(),
                limit_price,
                status,
                float(filled_avg_price) if filled_avg_price else None,
                float(filled_qty) if filled_qty else 0.0,
                submitted_at,
                json.dumps(order_dict, default=str),
            ),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to persist trade order: {e}")


@router.post("/execute")
async def execute_option_trade(payload: ExecuteTradeRequest):
    """
    Execute an options or equity trade proposal via Alpaca MCP Server and Trading API.
    Audited by the Guardian Risk Engine.
    """
    target_symbol = (payload.option_symbol or payload.symbol).strip().upper()
    is_option = len(target_symbol) > 6 and any(c.isdigit() for c in target_symbol)

    try:
        # 1. Attempt execution through Alpaca MCP Server tool
        order_result = None
        execution_engine = "Alpaca MCP Server (FastMCP)"
        
        try:
            if is_option:
                mcp_res = await mcp_place_option_order(
                    symbol=target_symbol,
                    qty=int(payload.quantity),
                    side=payload.side,
                    order_type=payload.order_type,
                    limit_price=payload.limit_price,
                    position_intent="buy_to_open" if payload.side.lower() == "buy" else "sell_to_close",
                )
            else:
                mcp_res = await mcp_place_stock_order(
                    symbol=target_symbol,
                    qty=payload.quantity,
                    side=payload.side,
                    order_type=payload.order_type,
                    limit_price=payload.limit_price,
                )

            if isinstance(mcp_res, dict) and (mcp_res.get("id") or mcp_res.get("symbol")):
                order_result = mcp_res
            elif isinstance(mcp_res, str):
                try:
                    order_result = json.loads(mcp_res)
                except Exception:
                    pass
        except Exception as mcp_err:
            logger.warning(f"MCP order tool execution failed, falling back to direct SDK: {mcp_err}")

        # 2. Fallback to direct Alpaca Trading API SDK if MCP tool response was unparsed
        if not order_result:
            execution_engine = "Alpaca Trading API SDK"
            sdk_order = submit_option_order(
                symbol=target_symbol,
                qty=payload.quantity,
                side=payload.side,
                order_type=payload.order_type,
                limit_price=payload.limit_price,
            )
            if isinstance(sdk_order, dict):
                order_result = {
                    "id": str(sdk_order.get("id", "")),
                    "client_order_id": str(sdk_order.get("client_order_id", "")),
                    "symbol": str(sdk_order.get("symbol", target_symbol)),
                    "qty": float(sdk_order.get("qty", payload.quantity)),
                    "side": str(sdk_order.get("side", payload.side)),
                    "type": str(sdk_order.get("type", payload.order_type)),
                    "status": str(sdk_order.get("status", "submitted")),
                    "submitted_at": str(sdk_order.get("submitted_at", datetime.now(timezone.utc).isoformat())),
                    "filled_avg_price": float(sdk_order["filled_avg_price"]) if sdk_order.get("filled_avg_price") is not None else None,
                    "filled_qty": float(sdk_order.get("filled_qty", 0)),
                }
            else:
                order_result = {
                    "id": str(sdk_order.id),
                    "client_order_id": sdk_order.client_order_id,
                    "symbol": sdk_order.symbol or target_symbol,
                    "qty": float(sdk_order.qty) if sdk_order.qty else float(payload.quantity),
                    "side": str(sdk_order.side),
                    "type": str(sdk_order.type),
                    "status": str(sdk_order.status),
                    "submitted_at": str(sdk_order.submitted_at),
                    "filled_avg_price": float(sdk_order.filled_avg_price) if sdk_order.filled_avg_price else None,
                    "filled_qty": float(sdk_order.filled_qty) if sdk_order.filled_qty else 0.0,
                }

        # 3. Persist and Log
        record_order_in_db(
            order_result,
            symbol=payload.symbol,
            option_symbol=payload.option_symbol,
            side=payload.side,
            qty=payload.quantity,
            order_type=payload.order_type,
            limit_price=payload.limit_price,
        )

        log_agent_action(
            payload.source,
            "order_executed",
            {
                "engine": execution_engine,
                "symbol": payload.symbol,
                "option_symbol": payload.option_symbol,
                "side": payload.side,
                "qty": payload.quantity,
                "order_id": order_result.get("id"),
            },
        )

        # 4. Fetch updated account details for immediate frontend reflection
        account_summary = None
        try:
            acc: Any = get_account()
            if isinstance(acc, dict):
                account_summary = {
                    "equity": str(acc.get("equity", "0")),
                    "buying_power": str(acc.get("buying_power", "0")),
                    "cash": str(acc.get("cash", "0")),
                }
            else:
                account_summary = {
                    "equity": str(getattr(acc, "equity", "0")),
                    "buying_power": str(getattr(acc, "buying_power", "0")),
                    "cash": str(getattr(acc, "cash", "0")),
                }
        except Exception as acc_err:
            logger.warning(f"Could not fetch updated account in execute trade: {acc_err}")

        return {
            "success": True,
            "message": f"Option order submitted successfully via {execution_engine}",
            "execution_engine": execution_engine,
            "order": order_result,
            "account": account_summary,
        }

    except Exception as e:
        logger.error(f"Option order execution failed: {e}")
        err_msg = str(e)
        try:
            if "{" in err_msg and "}" in err_msg:
                json_part = err_msg[err_msg.index("{"):err_msg.rindex("}") + 1]
                parsed_err = json.loads(json_part)
                if isinstance(parsed_err, dict) and "message" in parsed_err:
                    err_msg = str(parsed_err["message"])
        except Exception:
            pass
        raise HTTPException(
            status_code=500,
            detail=f"Trade execution failed: {err_msg}",
        )


@router.post("/cancel/{order_id}")
@router.delete("/order/{order_id}")
async def cancel_trade_order(order_id: str):
    """
    Cancel an active or pending order via Alpaca MCP Server / Trading API.
    Updates SQLite audit history and logs agent action.
    """
    cleaned_order_id = order_id.strip()
    cancellation_engine = "Alpaca MCP Server (FastMCP)"
    mcp_result = None

    # 1. Try Alpaca MCP Server tool
    try:
        mcp_res = await mcp_cancel_order(cleaned_order_id)
        if isinstance(mcp_res, dict) and not mcp_res.get("error"):
            mcp_result = mcp_res
        elif isinstance(mcp_res, str):
            try:
                parsed = json.loads(mcp_res)
                if isinstance(parsed, dict) and not parsed.get("error"):
                    mcp_result = parsed
            except Exception:
                pass
    except Exception as err:
        logger.warning(f"MCP order cancellation failed, falling back to direct Alpaca SDK: {err}")

    # 2. Fallback to direct Alpaca Trading API SDK
    if not mcp_result:
        cancellation_engine = "Alpaca Trading API SDK"
        try:
            cancel_order(cleaned_order_id)
        except Exception as sdk_err:
            logger.error(f"Alpaca SDK cancel_order failed for {cleaned_order_id}: {sdk_err}")
            err_msg = str(sdk_err).lower()
            if "not found" in err_msg or "404" in err_msg:
                raise HTTPException(status_code=404, detail=f"Order {cleaned_order_id} not found on Alpaca")
            elif "cannot be canceled" in err_msg or "422" in err_msg or "filled" in err_msg:
                raise HTTPException(status_code=422, detail=f"Order {cleaned_order_id} cannot be canceled (already filled, canceled, or expired)")
            else:
                raise HTTPException(status_code=500, detail=f"Failed to cancel order: {str(sdk_err)}")

    # 3. Update SQLite trade_orders status to 'canceled'
    try:
        conn = get_connection()
        conn.execute(
            """
            UPDATE trade_orders
            SET status = 'canceled'
            WHERE order_id = ? OR client_order_id = ?
            """,
            (cleaned_order_id, cleaned_order_id),
        )
        conn.commit()
        conn.close()
    except Exception as db_err:
        logger.warning(f"Could not update trade_orders status to canceled: {db_err}")

    # 4. Log agent action
    try:
        log_agent_action(
            "PositionsManager",
            "order_cancelled",
            {
                "order_id": cleaned_order_id,
                "engine": cancellation_engine,
            },
        )
    except Exception as log_err:
        logger.warning(f"Could not log agent cancel action: {log_err}")

    # 5. Fetch updated account balance
    updated_account = None
    try:
        acc: Any = get_account()
        if isinstance(acc, dict):
            updated_account = {
                "equity": str(acc.get("equity", "0")),
                "buying_power": str(acc.get("buying_power", "0")),
                "cash": str(acc.get("cash", "0")),
            }
        else:
            updated_account = {
                "equity": str(getattr(acc, "equity", "0")),
                "buying_power": str(getattr(acc, "buying_power", "0")),
                "cash": str(getattr(acc, "cash", "0")),
            }
    except Exception:
        pass

    return {
        "success": True,
        "message": f"Order {cleaned_order_id} canceled successfully via {cancellation_engine}",
        "order_id": cleaned_order_id,
        "status": "canceled",
        "cancellation_engine": cancellation_engine,
        "account": updated_account,
    }


@router.get("/orders")
def get_order_history(limit: int = 50):
    """
    Retrieve recent trade order history from SQLite audit storage and Alpaca.
    Syncs live statuses from Alpaca into SQLite.
    """
    alpaca_orders = []
    alpaca_order_map = {}
    try:
        raw_orders = get_orders(limit=limit)
        if isinstance(raw_orders, list):
            for o in raw_orders:
                oid = str(o.id)
                ostat = getattr(o.status, "value", str(o.status)).lower()
                if "." in ostat:
                    ostat = ostat.split(".")[-1].lower()
                side_clean = getattr(o.side, "value", str(o.side)).lower().split(".")[-1]
                type_clean = getattr(o.type, "value", str(o.type)).lower().split(".")[-1]
                filled_avg = float(o.filled_avg_price) if getattr(o, "filled_avg_price", None) else None
                filled_q = float(o.filled_qty) if getattr(o, "filled_qty", None) else 0.0
                ord_dict = {
                    "id": oid,
                    "order_id": oid,
                    "symbol": str(o.symbol or ""),
                    "qty": float(o.qty) if o.qty else 0.0,
                    "quantity": float(o.qty) if o.qty else 0.0,
                    "side": side_clean,
                    "type": type_clean,
                    "order_type": type_clean,
                    "status": ostat,
                    "submitted_at": str(o.submitted_at),
                    "filled_avg_price": filled_avg,
                    "filled_qty": filled_q,
                }
                alpaca_orders.append(ord_dict)
                alpaca_order_map[oid] = ord_dict

            # Sync live status into SQLite
            try:
                conn = get_connection()
                for o in raw_orders:
                    oid = str(o.id)
                    ostat = getattr(o.status, "value", str(o.status)).lower().split(".")[-1]
                    filled_avg = float(o.filled_avg_price) if getattr(o, "filled_avg_price", None) else None
                    filled_q = float(o.filled_qty) if getattr(o, "filled_qty", None) else 0.0
                    conn.execute(
                        """
                        UPDATE trade_orders
                        SET status = ?, filled_avg_price = coalesce(?, filled_avg_price), filled_qty = ?
                        WHERE order_id = ?
                        """,
                        (ostat, filled_avg, filled_q, oid),
                    )
                conn.commit()
                conn.close()
            except Exception as sync_err:
                logger.warning(f"Could not sync alpaca order statuses to SQLite: {sync_err}")

    except Exception as e:
        logger.warning(f"Could not fetch alpaca orders: {e}")

    db_orders = []
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT order_id, client_order_id, symbol, option_symbol, side,
                   quantity, order_type, limit_price, status, filled_avg_price,
                   filled_qty, submitted_at
            FROM trade_orders
            ORDER BY submitted_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = cursor.fetchall()
        for row in rows:
            d = dict(row)
            # If alpaca has a fresher status, overlay it
            if d.get("order_id") in alpaca_order_map:
                d["status"] = alpaca_order_map[d["order_id"]]["status"]
                if alpaca_order_map[d["order_id"]].get("filled_avg_price"):
                    d["filled_avg_price"] = alpaca_order_map[d["order_id"]]["filled_avg_price"]
                if alpaca_order_map[d["order_id"]].get("filled_qty"):
                    d["filled_qty"] = alpaca_order_map[d["order_id"]]["filled_qty"]
            db_orders.append(d)
        conn.close()
    except Exception as e:
        logger.warning(f"Could not read db orders: {e}")

    # Combine recorded DB orders with any Alpaca recent orders not already in DB
    existing_ids = {o.get("order_id") for o in db_orders if o.get("order_id")}
    combined_orders = list(db_orders)
    import re
    for ao in alpaca_orders:
        if ao["id"] not in existing_ids:
            raw_sym = str(ao.get("symbol") or "").strip().upper()
            is_occ = len(raw_sym) > 6 and any(c.isdigit() for c in raw_sym)
            if is_occ:
                underlying_match = re.match(r"^([A-Z\.]+)", raw_sym)
                opt_symbol = raw_sym
                stock_sym = underlying_match.group(1).rstrip() if underlying_match else raw_sym
            else:
                opt_symbol = None
                stock_sym = raw_sym

            combined_orders.append({
                "order_id": ao["id"],
                "client_order_id": "",
                "symbol": stock_sym,
                "option_symbol": opt_symbol,
                "side": ao["side"],
                "quantity": ao["qty"],
                "order_type": ao["type"],
                "limit_price": None,
                "status": ao["status"],
                "filled_avg_price": ao["filled_avg_price"],
                "filled_qty": ao["filled_qty"],
                "submitted_at": ao["submitted_at"],
            })

    # Ensure strictly sorted by submitted_at DESC (newest at top)
    combined_orders.sort(key=lambda x: str(x.get("submitted_at") or ""), reverse=True)

    return {
        "recorded_orders": combined_orders,
        "alpaca_recent_orders": alpaca_orders,
    }


@router.post("/analyze", response_model=AnalysisResult)
def analyze_trade_endpoint(proposal: TradeProposal):
    """
    Analyze a proposed trade against TradeGuardian risk controls via /trade/analyze.
    """
    from routes.analyze import analyze_trade

    return analyze_trade(proposal)
