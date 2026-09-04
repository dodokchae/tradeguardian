import time
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agents.orchestrator import run_tradeguardian
from agents.autonomous_trader import (
    start_autonomous_trader,
    stop_autonomous_trader,
    get_autonomous_trader_status,
)
from services.alpaca_service import get_latest_price, get_asset_name


router = APIRouter(
    prefix="/agents",
    tags=["AI Agents"],
)


class RunAgentsRequest(BaseModel):
    symbols: Optional[list[str]] = Field(
        default=None,
        description="Optional list of stock or crypto symbols to analyze."
    )
    mode: Optional[str] = Field(
        default="all",
        description="Scan mode: 'all' (multi-asset deep scan across stocks, crypto & dynamic movers), 'dynamic' (dynamic movers only), 'crypto', or 'custom'."
    )
    min_confidence: Optional[float] = Field(
        default=0.0,
        description="Minimum confidence score hurdle (e.g. 75.0)."
    )
    force_refresh: Optional[bool] = Field(
        default=False,
        description="Force a fresh multi-agent scan, bypassing in-memory cache."
    )


@router.post("/run")
def run_agents(request: Optional[RunAgentsRequest] = None):
    """
    Run the complete TradeGuardian AI agent pipeline.

    Pipeline:
    Research Agent (parallel bars scanning across market / screener)
        ->
    Devil's Advocate
        ->
    Options Strategy Agent / Spot Crypto Agent
        ->
    Guardian Risk Agent
    """

    try:
        symbols = request.symbols if request else None
        mode = request.mode if (request and request.mode) else "core"
        min_conf = request.min_confidence if (request and request.min_confidence is not None) else 0.0
        refresh = request.force_refresh if (request and request.force_refresh is not None) else False

        results = run_tradeguardian(
            symbols=symbols,
            mode=mode,
            min_confidence=min_conf,
            force_refresh=refresh,
        )

        return {
            "message": f"TradeGuardian agent pipeline completed (mode: {mode}).",
            "total_analyzed": len(results),
            "results": results,
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                "TradeGuardian agent pipeline failed: "
                f"{type(error).__name__}: {str(error)}"
            ),
        )


@router.get("/top")
def get_top_opportunities(limit: int = 3, force_refresh: bool = False):
    """
    Retrieve the top highest-confidence, certified AI opportunities in real-time
    for the Dashboard Spotlight radar. Supports force_refresh to trigger fresh analysis.
    """
    try:
        # 1. Run or get from in-memory cache (bypassed if force_refresh=True)
        results = run_tradeguardian(symbols=None, force_refresh=force_refresh)
        if not results or len(results) < limit:
            # Fast scan on liquid leaders if cache is cold or insufficient
            results = run_tradeguardian(
                symbols=["NVDA", "QQQ", "AAPL", "MSFT", "TSLA", "PLTR", "AMZN", "META"],
                force_refresh=True,
            )

        # 2. Prefer approved setups
        approved = [
            r for r in results
            if (r.get("analysis") or {}).get("decision", {}).get("status") == "APPROVED"
        ]
        candidates = approved if len(approved) >= limit else results

        # 3. Format into spotlight format
        spotlight = []
        for r in candidates[:limit]:
            opp = r.get("opportunity") or {}
            prop_trade = r.get("proposed_trade") or {}
            proposal = r.get("proposal") or {}
            opt = proposal.get("option_contract") or {}
            symbol = r.get("symbol") or opp.get("symbol") or "NVDA"
            cur_price = float(opp.get("current_price") or 0.0)
            if cur_price <= 0.0:
                try:
                    cur_price = get_latest_price(symbol)
                except Exception:
                    cur_price = 100.0
            confidence = float(opp.get("confidence") or 75.0)
            bias = "Bullish" if str(opp.get("direction", "bullish")).lower() == "bullish" else "Bearish"

            raw_qty = prop_trade.get("quantity", 1)
            qty = float(raw_qty) if isinstance(raw_qty, (int, float)) else 1.0

            sl_pct = float(opp.get("suggested_sl_pct") or 2.5)
            tp_pct = float(opp.get("suggested_tp_pct") or (sl_pct * 2.4))
            potential_dollars = round(cur_price * (tp_pct / 100.0) * qty, 2)
            max_risk_dollars = round(cur_price * (sl_pct / 100.0) * qty, 2)

            reasoning = opp.get("reasoning", [])
            thesis_text = (
                " ".join(reasoning)
                if isinstance(reasoning, list) and reasoning
                else f"Price is trading above key moving averages with volume confirmation."
            )

            spotlight.append({
                "symbol": symbol,
                "name": get_asset_name(symbol),
                "strategy": prop_trade.get("strategy") or opt.get("strategy") or ("Bull Call Spread" if bias == "Bullish" else "Bear Put Spread"),
                "bias": bias,
                "confidence": round(confidence, 1),
                "potential": f"+${potential_dollars:,.2f}",
                "maxRisk": f"${max_risk_dollars:,.2f}",
                "thesis": thesis_text,
                "proposedTrade": prop_trade,
                "market_regime": opp.get("market_regime", "TREND_CONTINUATION"),
                "is_overextended": opp.get("is_overextended", False),
                "roc_30d": opp.get("roc_30d", 0.0),
                "pct_from_sma20": opp.get("pct_from_sma20", 0.0),
                "pullback_support_price": opp.get("pullback_support_price"),
                "adx": opp.get("adx", 25.0),
                "volume_trend": opp.get("volume_trend", "NORMAL"),
                "expected_value": opp.get("expected_value"),
            })

        return {
            "timestamp": int(time.time() * 1000),
            "count": len(spotlight),
            "opportunities": spotlight,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve top AI opportunities: {str(e)}",
        )


@router.get("/autonomous/status")
def get_autonomous_status():
    """Retrieve the live status and telemetry of the autonomous trading swarm."""
    return get_autonomous_trader_status()


@router.post("/autonomous/start")
def start_autonomous():
    """Start the autonomous background trading swarm."""
    return start_autonomous_trader()


@router.post("/autonomous/stop")
def stop_autonomous():
    """Stop the autonomous background trading swarm."""
    return stop_autonomous_trader()