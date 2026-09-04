import logging
import math
import re
from datetime import date, datetime, timezone
from typing import Any, Optional
from pydantic import BaseModel, Field

from services.alpaca_service import get_positions, close_option_position, get_latest_price, fetch_snapshots_for_symbols
from services.mcp_service import mcp_close_position, log_agent_action

logger = logging.getLogger("TradeGuardian.PositionManager")

# Match OCC standard symbol format (e.g. AAPL260918C00360000 or TSLA260916P00250000)
OCC_REGEX = re.compile(r"^([A-Z\.]+)\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$")


class ManagedPosition(BaseModel):
    asset_id: str
    symbol: str
    is_option: bool = False
    is_crypto: bool = False
    asset_class: Optional[str] = None
    underlying_symbol: Optional[str] = None
    option_type: Optional[str] = None
    strike_price: Optional[float] = None
    expiration_date: Optional[str] = None
    days_to_expiration: Optional[int] = None
    qty: float
    avg_entry_price: float
    current_price: float
    market_value: float
    cost_basis: float
    unrealized_pl: float
    unrealized_plpc: float  # e.g. 0.25 for +25%
    recommendation: str     # HOLD, TAKE_PROFIT, STOP_LOSS, EXPIRATION_GUARD
    action_reason: str
    status: str = "active"


def _safe_float(val: Any, default: float = 0.0) -> float:
    """Safely convert any numeric or string value to float, handling None, NaN, inf, and invalid strings."""
    if val is None:
        return default
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (ValueError, TypeError):
        return default


def parse_occ_symbol(symbol: str) -> dict[str, Any] | None:
    """Parse OCC option symbol into components (e.g. TSLA260918C00360000)."""
    if not symbol or not isinstance(symbol, str):
        return None

    clean_symbol = symbol.strip().upper()
    match = OCC_REGEX.match(clean_symbol)
    if not match:
        return None

    underlying = match.group(1).rstrip()
    try:
        year = 2000 + int(match.group(2))
        month = int(match.group(3))
        day = int(match.group(4))
        exp_date = date(year, month, day)
        days_left = (exp_date - date.today()).days
    except (ValueError, OverflowError):
        return None

    opt_type = "call" if match.group(5) == "C" else "put"
    strike = int(match.group(6)) / 1000.0

    return {
        "underlying": underlying,
        "option_type": opt_type,
        "expiration_date": exp_date.isoformat(),
        "days_to_expiration": days_left,
        "strike_price": strike,
    }


def analyze_position(pos: Any) -> ManagedPosition:
    """Analyze a single Alpaca position against risk & profit management rules."""
    if isinstance(pos, dict):
        symbol = str(pos.get("symbol") or "").strip().upper()
        asset_id = str(pos.get("asset_id") or pos.get("id") or "")
        qty = _safe_float(pos.get("qty"))
        avg_entry_price = _safe_float(pos.get("avg_entry_price"))
        current_price = _safe_float(pos.get("current_price"))
        market_value = _safe_float(pos.get("market_value"))
        cost_basis = _safe_float(pos.get("cost_basis"))
        unrealized_pl = _safe_float(pos.get("unrealized_pl"))
        unrealized_plpc = _safe_float(pos.get("unrealized_plpc"))
        asset_class_str = str(pos.get("asset_class") or "").lower()
    else:
        symbol = str(getattr(pos, "symbol", "") or "").strip().upper()
        asset_id = str(getattr(pos, "asset_id", getattr(pos, "id", "")) or "")
        qty = _safe_float(getattr(pos, "qty", 0))
        avg_entry_price = _safe_float(getattr(pos, "avg_entry_price", 0))
        current_price = _safe_float(getattr(pos, "current_price", 0))
        market_value = _safe_float(getattr(pos, "market_value", 0))
        cost_basis = _safe_float(getattr(pos, "cost_basis", 0))
        unrealized_pl = _safe_float(getattr(pos, "unrealized_pl", 0))
        unrealized_plpc = _safe_float(getattr(pos, "unrealized_plpc", 0))
        asset_class_str = str(getattr(pos, "asset_class", "")).lower()

    occ_data = parse_occ_symbol(symbol)
    is_option = occ_data is not None or "option" in asset_class_str

    known_crypto = {
        "BTC", "ETH", "SOL", "DOGE", "AVAX", "LINK", "UNI", "ADA", "DOT",
        "NEAR", "MATIC", "POL", "XRP", "LTC", "BCH", "ATOM", "XLM", "ALGO",
        "FIL", "ICP", "AAVE", "SHIB", "PEPE", "SUI", "APT", "RENDER", "FET"
    }
    is_crypto = (
        "crypto" in asset_class_str or
        "/" in symbol or
        symbol in known_crypto or
        (symbol.endswith("USD") and symbol[:-3] in known_crypto) or
        (symbol.endswith("USDT") and symbol[:-4] in known_crypto)
    )
    detected_asset_class = "crypto" if is_crypto else ("us_option" if is_option else "us_equity")

    # Fallback current_price to avg_entry_price if Alpaca provides None/0 outside market hours
    if current_price <= 0.0 and avg_entry_price > 0.0:
        current_price = avg_entry_price

    multiplier = 100.0 if is_option else 1.0

    abs_qty = abs(qty)
    is_short = qty < 0

    # Refresh with latest live market price if available for equities, crypto, and options
    if symbol:
        try:
            live = get_latest_price(symbol, max_cache_age=1.5)
            if live and live > 0:
                current_price = live
        except Exception:
            pass

    # Derive cost_basis if missing
    if cost_basis <= 0.0 and avg_entry_price > 0.0 and abs_qty > 0.0:
        cost_basis = avg_entry_price * abs_qty * multiplier

    # Derive market_value
    if current_price > 0.0 and abs_qty > 0.0:
        market_value = current_price * abs_qty * multiplier

    # Re-calculate unrealized_pl and unrealized_plpc from current_price and cost_basis
    if market_value > 0.0 and cost_basis > 0.0:
        if is_short:
            unrealized_pl = cost_basis - market_value
        else:
            unrealized_pl = market_value - cost_basis
        unrealized_plpc = unrealized_pl / cost_basis

    unrealized_plpc = _safe_float(unrealized_plpc, 0.0)

    # Management Decision Rules
    recommendation = "HOLD"
    reason = "Position is within normal risk tolerance thresholds."

    # Rule 1: Take Profit Target (+50% for options, +20% for equities)
    profit_target = 0.50 if is_option else 0.20
    if unrealized_plpc >= profit_target:
        recommendation = "TAKE_PROFIT"
        reason = f"Target reached (+{round(unrealized_plpc * 100, 1)}% >= +{int(profit_target * 100)}%). Lock in alpha."
    elif unrealized_plpc >= (0.30 if is_option else 0.12):
        # Rule 1b: Trailing Profit Lock (+30% options / +12% equities)
        recommendation = "TRAILING_LOCK"
        reason = f"Trailing profit lock armed (+{round(unrealized_plpc * 100, 1)}%). Guardian locking in gains."

    # Rule 2: Stop Loss Guard (-25% for options, -10% for equities)
    stop_loss_threshold = -0.25 if is_option else -0.10
    if unrealized_plpc <= stop_loss_threshold:
        recommendation = "STOP_LOSS"
        reason = f"Loss threshold breached ({round(unrealized_plpc * 100, 1)}% <= {int(stop_loss_threshold * 100)}%). Capital protection triggered."

    # Rule 3: Expiration Guard (DTE <= 1 day for options)
    if is_option and occ_data and occ_data.get("days_to_expiration") is not None:
        dte = occ_data["days_to_expiration"]
        if dte <= 1:
            if recommendation == "HOLD":
                recommendation = "EXPIRATION_GUARD"
                day_str = "today" if dte == 0 else ("already" if dte < 0 else f"in {dte} day(s)")
                reason = f"Option expires {day_str}. Close position to prevent pin risk and assignment."
            else:
                reason += f" (Note: Option expires in {dte} day(s))."

    return ManagedPosition(
        asset_id=asset_id,
        symbol=symbol,
        is_option=is_option,
        is_crypto=is_crypto,
        asset_class=detected_asset_class,
        underlying_symbol=occ_data["underlying"] if occ_data else symbol,
        option_type=occ_data["option_type"] if occ_data else None,
        strike_price=occ_data["strike_price"] if occ_data else None,
        expiration_date=occ_data["expiration_date"] if occ_data else None,
        days_to_expiration=occ_data["days_to_expiration"] if occ_data else None,
        qty=qty,
        avg_entry_price=round(avg_entry_price, 4),
        current_price=round(current_price, 4),
        market_value=round(market_value, 2),
        cost_basis=round(cost_basis, 2),
        unrealized_pl=round(unrealized_pl, 2),
        unrealized_plpc=round(unrealized_plpc, 4),
        recommendation=recommendation,
        action_reason=reason,
    )


def scan_managed_positions() -> list[ManagedPosition]:
    """
    Scan all active portfolio positions and evaluate management policies.
    Features per-position exception isolation so one malformed contract never breaks the panel.
    """
    raw_positions = []
    try:
        raw_positions = get_positions() or []
    except Exception as err:
        logger.warning(f"Direct SDK get_positions failed in scan_managed_positions: {err}")

    # Eagerly refresh live market snapshots for all active portfolio positions in parallel
    if raw_positions:
        try:
            active_symbols = [
                str(p.get("symbol") if isinstance(p, dict) else getattr(p, "symbol", "")).strip().upper()
                for p in raw_positions
            ]
            fetch_snapshots_for_symbols([s for s in active_symbols if s])
        except Exception as snap_err:
            logger.warning(f"Batch snapshot refresh in scan_managed_positions failed: {snap_err}")

    results: list[ManagedPosition] = []
    for p in raw_positions:
        try:
            analyzed = analyze_position(p)
            results.append(analyzed)
        except Exception as p_err:
            sym = str(p.get("symbol") if isinstance(p, dict) else getattr(p, "symbol", "UNKNOWN")).strip().upper()
            logger.error(f"Failed to analyze individual position {sym}: {p_err}")
            try:
                q = _safe_float(p.get("qty") if isinstance(p, dict) else getattr(p, "qty", 0))
                entry = _safe_float(p.get("avg_entry_price") if isinstance(p, dict) else getattr(p, "avg_entry_price", 0))
                curr = _safe_float(p.get("current_price") if isinstance(p, dict) else getattr(p, "current_price", entry)) or entry
                pl = _safe_float(p.get("unrealized_pl") if isinstance(p, dict) else getattr(p, "unrealized_pl", 0))
                plpc = _safe_float(p.get("unrealized_plpc") if isinstance(p, dict) else getattr(p, "unrealized_plpc", 0))
                fallback_is_opt = len(sym) > 6 and any(c.isdigit() for c in sym)
                fallback_is_crypto = "/" in sym or sym.endswith("USD") or sym.endswith("USDT")
                results.append(
                    ManagedPosition(
                        asset_id=str(p.get("asset_id") if isinstance(p, dict) else getattr(p, "asset_id", getattr(p, "id", ""))),
                        symbol=sym,
                        is_option=fallback_is_opt,
                        is_crypto=fallback_is_crypto,
                        asset_class="crypto" if fallback_is_crypto else ("us_option" if fallback_is_opt else "us_equity"),
                        underlying_symbol=sym[:4] if len(sym) > 6 else sym,
                        qty=q,
                        avg_entry_price=entry,
                        current_price=curr,
                        market_value=curr * q,
                        cost_basis=entry * q,
                        unrealized_pl=pl,
                        unrealized_plpc=round(plpc, 4),
                        recommendation="HOLD",
                        action_reason="Active portfolio position monitored by Guardian Risk Engine.",
                    )
                )
            except Exception as fallback_err:
                logger.error(f"Fallback baseline position build failed for {sym}: {fallback_err}")

    return results


async def execute_position_exit(symbol: str, qty: float | None = None) -> dict[str, Any]:
    """Execute position exit via Alpaca Trading API SDK / MCP with graceful fallback and extended-hours support."""
    clean_symbol = symbol.strip().upper() if symbol else ""
    engine = "Alpaca Trading API SDK"
    sdk_error = None
    try:
        res = close_option_position(clean_symbol, qty)
        result_data = {
            "id": str(getattr(res, "id", "")),
            "symbol": clean_symbol,
            "status": str(getattr(res, "status", "filled")),
        }
    except Exception as e:
        sdk_error = str(e)
        logger.warning(f"SDK close_position failed for {clean_symbol}, falling back to FastMCP: {e}")
        engine = "Alpaca MCP Server (FastMCP)"
        try:
            res = await mcp_close_position(clean_symbol, qty)
            result_data = res
        except Exception as mcp_err:
            logger.error(f"Both SDK and MCP close_position failed for {clean_symbol}: {mcp_err}")
            return {
                "success": False,
                "engine": "failed",
                "symbol": clean_symbol,
                "error": f"SDK: {sdk_error} | MCP: {mcp_err}",
            }

    log_agent_action(
        "PositionManagerAgent",
        "close_position",
        {"symbol": clean_symbol, "engine": engine, "result": result_data},
    )

    return {
        "success": True,
        "engine": engine,
        "symbol": clean_symbol,
        "result": result_data,
    }


async def run_autonomous_position_manager(auto_execute: bool = False) -> dict[str, Any]:
    """
    Run the autonomous position manager cycle.
    If auto_execute is True, automatically executes TAKE_PROFIT, STOP_LOSS, and EXPIRATION_GUARD orders.
    """
    positions = scan_managed_positions()
    actions_taken = []

    for pos in positions:
        if auto_execute and pos.recommendation in ("TAKE_PROFIT", "STOP_LOSS", "EXPIRATION_GUARD"):
            try:
                exit_res = await execute_position_exit(pos.symbol, pos.qty)
                actions_taken.append({
                    "symbol": pos.symbol,
                    "action": pos.recommendation,
                    "reason": pos.action_reason,
                    "result": exit_res,
                })
            except Exception as err:
                logger.error(f"Failed to auto-close {pos.symbol}: {err}")

    # Summary metrics
    total_unrealized_pl = sum(p.unrealized_pl for p in positions)
    options_count = sum(1 for p in positions if p.is_option)

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_positions": len(positions),
        "options_positions": options_count,
        "total_unrealized_pl": round(total_unrealized_pl, 2),
        "positions": [p.model_dump() for p in positions],
        "actions_taken": actions_taken,
    }
