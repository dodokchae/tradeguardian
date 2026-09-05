import threading
import time
from concurrent.futures import (
    ThreadPoolExecutor,
    as_completed,
)
from agents.devil_advocate import (
    review_opportunity,
)
from agents.guardian_agent import (
    evaluate_trade,
    calculate_optimal_trade_size,
    is_related_contract_or_asset,
)
from agents.options_strategy_agent import (
    select_option_contract,
)
from agents.research_agent import (
    scan_market,
    scan_dynamic_market,
    get_unified_deep_scan_universe,
    CRYPTO_MARKET_UNIVERSE,
)
from models.decision import DecisionStatus

_ORCHESTRATOR_CACHE: dict[str, tuple[float, list[dict]]] = {}
_CACHE_LOCK = threading.Lock()
CACHE_TTL_SECONDS = 300  # 5 minutes


def _evaluate_single_opportunity(opportunity, account=None, positions=None):
    """
    Process an individual opportunity through Devil's Advocate,
    Options Strategy Agent, and Guardian Risk Engine with account-aware sizing.
    """
    try:
        review = review_opportunity(opportunity)
        proposal = select_option_contract(opportunity)

        cur_price = float(getattr(opportunity, "current_price", 100.0))
        account_equity = float(getattr(account, "equity", 100000.0))
        buying_power = float(getattr(account, "buying_power", 400000.0))

        # Calculate existing exposure and quantity to underlying
        existing_val = 0.0
        existing_qty = 0.0
        if positions:
            for pos in positions:
                psym = str(getattr(pos, "symbol", "")).upper()
                if is_related_contract_or_asset(psym, opportunity.symbol):
                    existing_val += abs(float(getattr(pos, "market_value", 0.0)))
                clean_psym = psym.replace('/', '').replace('-', '')
                clean_opp = opportunity.symbol.upper().replace('/', '').replace('-', '')
                if clean_psym == clean_opp:
                    existing_qty += abs(float(getattr(pos, "qty", 0.0)))

        # Sized safely at <= 4.5% of equity (strictly below the 5.0% warning threshold)
        safe_qty = calculate_optimal_trade_size(
            symbol=opportunity.symbol,
            price=cur_price,
            account_equity=account_equity,
            buying_power=buying_power,
            existing_holdings_value=existing_val,
            target_risk_percent=4.5,
        )

        is_bull = (
            str(getattr(opportunity.direction, "value", opportunity.direction)).lower()
            == "bullish"
        )
        is_crypto = "/" in opportunity.symbol or opportunity.symbol.endswith("USD") or opportunity.symbol in {"BTCUSD", "ETHUSD", "SOLUSD", "DOGEUSD", "AVAXUSD"}

        if is_crypto:
            if is_bull:
                side_str = "BUY"
                opt_strategy = "Spot Long (Guardian SL/TP)"
            else:
                side_str = "SELL"
                opt_strategy = "Spot Protective Exit / Hedge"
                # If holding units, clamp to existing holdings for protective profit-taking/exit
                if existing_qty > 0:
                    safe_qty = min(safe_qty, existing_qty)
        else:
            # Equities / Options:
            # Options entry is ALWAYS BUY (Buy Call spread or Buy Put spread)!
            # We never place a naked spot sell order on equities when entering a derivative position.
            side_str = "BUY"
            opt_strategy = (
                proposal.option_contract.strategy
                if (proposal and proposal.option_contract)
                else ("Bull Call Spread" if is_bull else "Bear Put Spread")
            )

        # Dynamic Smart Stop-Loss & Take-Profit calculation
        sl_pct = getattr(opportunity, "suggested_sl_pct", None)
        tp_pct = getattr(opportunity, "suggested_tp_pct", None)
        sl_price = getattr(opportunity, "suggested_sl_price", None)
        tp_price = getattr(opportunity, "suggested_tp_price", None)

        if sl_pct is None or sl_price is None or tp_pct is None or tp_price is None:
            sl_pct = 3.2 if is_crypto else 2.4
            tp_pct = round(sl_pct * 2.4, 1)
            sl_price = round(
                cur_price * (1.0 - sl_pct / 100.0) if is_bull else cur_price * (1.0 + sl_pct / 100.0),
                4 if cur_price < 1.0 else 2,
            )
            tp_price = round(
                cur_price * (1.0 + tp_pct / 100.0) if is_bull else cur_price * (1.0 - tp_pct / 100.0),
                4 if cur_price < 1.0 else 2,
            )

        sl_fmt = f"${sl_price:.4f}" if cur_price < 10.0 else f"${sl_price:,.2f}"
        tp_fmt = f"${tp_price:.4f}" if cur_price < 10.0 else f"${tp_price:,.2f}"
        entry_fmt = f"{cur_price:.4f}" if cur_price < 1.0 else f"{cur_price:.2f}"

        opp_rvol = getattr(opportunity, "rvol", None)
        proposed_trade = {
            "symbol": opportunity.symbol,
            "orderSide": side_str,
            "quantity": safe_qty,
            "executionType": "Market",
            "entryPrice": entry_fmt,
            "guardianSL": f"{sl_pct:.1f}% ({sl_fmt})",
            "guardianTP": f"{tp_pct:.1f}% ({tp_fmt})",
            "strategy": opt_strategy,
            "assetClass": "crypto" if is_crypto else "us_equity",
            "rvol": opp_rvol,
        }

        # Run Guardian risk audit directly on the actual proposed trade parameters with safe_qty
        analysis = evaluate_trade(
            {
                "symbol": opportunity.symbol,
                "side": side_str.lower(),
                "quantity": safe_qty,
                "price": cur_price,
                "entry_price": cur_price,
                "strategy": opt_strategy,
            },
            account=account,
            positions=positions,
        )

        # Smart Remediation: If flagged or blocked, attempt fine-grained downsizing to achieve clean approval
        if analysis and getattr(analysis.decision, "status", None) != DecisionStatus.APPROVED:
            recomputed_qty = calculate_optimal_trade_size(
                symbol=opportunity.symbol,
                price=cur_price,
                account_equity=account_equity,
                buying_power=buying_power,
                existing_holdings_value=existing_val,
                target_risk_percent=3.5,
            )
            if recomputed_qty > 0 and recomputed_qty != safe_qty:
                safe_qty = recomputed_qty
                proposed_trade["quantity"] = safe_qty
                analysis = evaluate_trade(
                    {
                        "symbol": opportunity.symbol,
                        "side": side_str.lower(),
                        "quantity": safe_qty,
                        "price": cur_price,
                        "entry_price": cur_price,
                        "strategy": opt_strategy,
                    },
                    account=account,
                    positions=positions,
                )

        return {
            "symbol": opportunity.symbol,
            "opportunity": opportunity.model_dump(mode="json"),
            "devil_advocate": review.model_dump(mode="json"),
            "proposal": proposal.model_dump(mode="json") if proposal else None,
            "analysis": analysis.model_dump(mode="json") if analysis else None,
            "proposed_trade": proposed_trade,
        }
    except Exception as err:
        print(
            f"Error processing opportunity for {getattr(opportunity, 'symbol', 'unknown')}: {err}"
        )
        return None


def run_tradeguardian(
    symbols: list[str] | None = None,
    mode: str = "core",
    min_confidence: float = 0.0,
    force_refresh: bool = False,
):
    """
    Run the complete TradeGuardian multi-agent analysis pipeline across all
    detected market opportunities. Supports full deep scan (stocks + crypto + dynamic movers),
    dynamic movers only, or custom symbols.
    """
    # Check cache unless force_refresh requested
    cache_key = f"{mode}_{','.join(sorted(symbols)) if symbols else '__ALL__'}_{min_confidence}"
    now = time.time()

    if not force_refresh:
        with _CACHE_LOCK:
            if cache_key in _ORCHESTRATOR_CACHE:
                cached_time, cached_results = _ORCHESTRATOR_CACHE[cache_key]
                if now - cached_time < CACHE_TTL_SECONDS:
                    return cached_results

    # 1. Scan market universe based on mode
    if symbols and len(symbols) > 0:
        opportunities = scan_market(symbols=symbols)
    elif mode == "dynamic":
        # Dynamic Movers Only: scans session's top volume/momentum runners
        opportunities = scan_dynamic_market(limit=18, force_refresh=force_refresh)
    elif mode == "crypto":
        opportunities = scan_market(symbols=CRYPTO_MARKET_UNIVERSE)
    else:
        # Full Multi-Asset Deep Scan ("all", "deep", or "core"):
        # Dynamically integrates high-volume breakout movers + 24/7 crypto leaders + core benchmark stocks
        deep_symbols = get_unified_deep_scan_universe(force_refresh=force_refresh)
        opportunities = scan_market(symbols=deep_symbols)

    if not opportunities:
        return []

    # Optional confidence hurdle filter
    if min_confidence > 0.0:
        opportunities = [opp for opp in opportunities if opp.confidence >= min_confidence]

    # Process ALL detected opportunities without artificial truncation
    target_opportunities = opportunities

    # Pre-fetch live account and positions once
    try:
        from services.alpaca_service import get_account, get_positions
        shared_account = get_account()
        shared_positions = get_positions() or []
    except Exception:
        shared_account = None
        shared_positions = None

    results = []

    # Run opportunity options contract selection & risk evaluation concurrently with rate-limit protection
    max_workers = min(len(target_opportunities), 4)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_evaluate_single_opportunity, opp, shared_account, shared_positions): opp
            for opp in target_opportunities
        }
        for future in as_completed(futures):
            try:
                res = future.result()
                if not res or not isinstance(res, dict):
                    continue

                # STRICT GUARDIAN RISK GATE:
                # Only opportunities that are fully APPROVED by the Guardian policy audit
                # are surfaced in AI Opportunities! Blocked or flagged setups are filtered out.
                analysis = res.get("analysis")
                if analysis and isinstance(analysis, dict):
                    decision = analysis.get("decision") or {}
                    status = decision.get("status")
                    if status != "APPROVED":
                        continue
                results.append(res)
            except Exception as err:
                print(f"Failed in orchestrator future: {err}")

    # Sort results by agent confidence descending (highest confidence first)
    results.sort(
        key=lambda x: (x.get("opportunity") or {}).get("confidence", 0),
        reverse=True,
    )

    with _CACHE_LOCK:
        _ORCHESTRATOR_CACHE[cache_key] = (now, results)

    return results