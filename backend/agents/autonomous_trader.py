import asyncio
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any

from agents.orchestrator import run_tradeguardian
from services.alpaca_service import trading_client, get_latest_price, POPULAR_MARKET_SYMBOLS
from services.mcp_service import log_agent_action, call_mcp_tool

logger = logging.getLogger("TradeGuardian.AutonomousTrader")

class AutonomousTraderState:
    def __init__(self):
        self.is_active: bool = False
        self.interval_seconds: int = 120  # Runs every 2 minutes
        self.last_scan_time: str | None = None
        self.total_scans: int = 0
        self.trades_executed: int = 0
        self.max_daily_trades: int = 5
        self.recent_activity: list[dict[str, Any]] = []
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def to_dict(self) -> dict[str, Any]:
        with self._lock:
            return {
                "is_active": self.is_active,
                "interval_seconds": self.interval_seconds,
                "last_scan_time": self.last_scan_time,
                "total_scans": self.total_scans,
                "trades_executed": self.trades_executed,
                "max_daily_trades": self.max_daily_trades,
                "recent_activity": self.recent_activity[-20:],
            }

    def log_activity(self, message: str, level: str = "INFO", details: Any = None):
        with self._lock:
            entry = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "message": message,
                "level": level,
                "details": details,
            }
            self.recent_activity.append(entry)
            if len(self.recent_activity) > 100:
                self.recent_activity.pop(0)
            logger.info(f"[{level}] {message}")

trader_state = AutonomousTraderState()


def _autonomous_worker_loop():
    """Background loop that continuously surveys the market and executes high-conviction certified setups."""
    logger.info("Autonomous Trader Swarm thread started.")
    trader_state.log_activity("Autonomous Trader Swarm initiated and armed.", "SUCCESS")

    while trader_state.is_active:
        try:
            start_time = time.time()
            now_iso = datetime.now(timezone.utc).isoformat()
            trader_state.last_scan_time = now_iso
            trader_state.total_scans += 1

            # 1. Manage active positions first: Auto-exit any positions breaching Guardian TP/SL policies
            try:
                from agents.position_manager_agent import run_autonomous_position_manager
                loop = asyncio.new_event_loop()
                pos_eval = loop.run_until_complete(run_autonomous_position_manager(auto_execute=True))
                loop.close()
                if pos_eval.get("actions_taken"):
                    trader_state.log_activity(
                        f"Guardian Auto-Exit executed {len(pos_eval['actions_taken'])} exit order(s) for positions breaching risk policies.",
                        "ACTION",
                        pos_eval["actions_taken"],
                    )
            except Exception as pm_err:
                logger.warning(f"Position manager cycle error in autonomous worker: {pm_err}")

            # 2. Focus on highest-liquidity benchmark equities & tech leaders
            focus_symbols = ["SPY", "QQQ", "NVDA", "AAPL", "MSFT", "AMZN", "META", "AMD", "PLTR", "TSLA"]
            trader_state.log_activity(f"Scanning market universe ({len(focus_symbols)} liquid leaders)...", "INFO")

            # Run TradeGuardian multi-agent orchestrator
            raw_results = run_tradeguardian(symbols=focus_symbols)
            opportunities = (
                raw_results if isinstance(raw_results, list) else raw_results.get("opportunities", [])
            )
            certified_ops = []
            for item in opportunities:
                opp = item.get("opportunity") if isinstance(item, dict) and "opportunity" in item else item
                analysis = item.get("analysis") if isinstance(item, dict) else None
                is_certified = (analysis.get("decision") == "APPROVED") if analysis else opp.get("guardian_certified", False)
                conf = opp.get("confidence", 0)
                if is_certified and conf >= 75:
                    certified_ops.append({
                        "symbol": opp.get("symbol"),
                        "bias": opp.get("bias", "Bullish"),
                        "confidence": conf,
                    })

            trader_state.log_activity(
                f"Market scan complete. Found {len(opportunities)} setups, {len(certified_ops)} certified by Guardian.",
                "INFO",
            )

            # If certified opportunities exist and we haven't hit daily trade limits
            if certified_ops and trader_state.trades_executed < trader_state.max_daily_trades:
                # Pick the highest confidence certified opportunity
                best_op = sorted(certified_ops, key=lambda x: x.get("confidence", 0), reverse=True)[0]
                sym = best_op.get("symbol")
                bias = best_op.get("bias", "Bullish")
                confidence = best_op.get("confidence", 0)

                trader_state.log_activity(
                    f"Selected top setup: {sym} ({bias}, {confidence}% confidence). Checking account buying power...",
                    "DECISION",
                )

                # Check account equity to prevent over-allocation
                try:
                    account = trading_client.get_account()
                    buying_power = float(getattr(account, "buying_power", 0))

                    if buying_power > 2000:
                        # Auto-place order on Alpaca
                        from alpaca.trading.requests import MarketOrderRequest
                        from alpaca.trading.enums import OrderSide, TimeInForce

                        side = OrderSide.BUY if bias == "Bullish" else OrderSide.SELL
                        # Sizing: modest risk of 1-5 shares depending on stock price
                        curr_price = get_latest_price(sym)
                        qty = max(1, min(10, int(1500 / curr_price))) if curr_price > 0 else 1

                        order_req = MarketOrderRequest(
                            symbol=sym,
                            qty=qty,
                            side=side,
                            time_in_force=TimeInForce.DAY,
                        )
                        order = trading_client.submit_order(order_req)

                        trader_state.trades_executed += 1
                        log_agent_action(
                            "AutonomousTrader",
                            "AUTO_EXECUTE_ORDER",
                            {
                                "symbol": sym,
                                "side": str(side),
                                "qty": qty,
                                "confidence": confidence,
                                "order_id": str(getattr(order, "id", "")),
                            },
                        )

                        trader_state.log_activity(
                            f"Successfully executed autonomous order: {side.value.upper()} {qty} shares of {sym} via Alpaca FastMCP! Order ID: {getattr(order, 'id', '')[:8]}...",
                            "SUCCESS",
                        )
                    else:
                        trader_state.log_activity("Insufficient buying power for new autonomous entry. Standing by.", "WARNING")
                except Exception as ex:
                    trader_state.log_activity(f"Order execution note: {ex}", "WARNING")

        except Exception as e:
            trader_state.log_activity(f"Autonomous worker exception: {e}", "ERROR")

        # Sleep interval in small chunks so stop is responsive
        sleep_remaining = trader_state.interval_seconds
        while sleep_remaining > 0 and trader_state.is_active:
            time.sleep(min(1.0, sleep_remaining))
            sleep_remaining -= 1.0

    logger.info("Autonomous Trader Swarm thread exited.")


def start_autonomous_trader() -> dict[str, Any]:
    """Start the background autonomous trading swarm."""
    if trader_state.is_active:
        return {"status": "already_running", "state": trader_state.to_dict()}

    trader_state.is_active = True
    trader_state._thread = threading.Thread(target=_autonomous_worker_loop, daemon=True)
    trader_state._thread.start()
    return {"status": "started", "state": trader_state.to_dict()}


def stop_autonomous_trader() -> dict[str, Any]:
    """Stop the background autonomous trading swarm."""
    trader_state.is_active = False
    trader_state.log_activity("Autonomous Trader Swarm paused by user.", "INFO")
    return {"status": "stopped", "state": trader_state.to_dict()}


def get_autonomous_trader_status() -> dict[str, Any]:
    """Get current status and activity log of autonomous trader."""
    return trader_state.to_dict()
