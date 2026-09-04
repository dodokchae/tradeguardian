import logging
from typing import Any, Union
from uuid import uuid4

from models.agent import AgentTradeProposal, OptionContractProposal, MarketDirection
from models.trade import TradeProposal
from models.decision import (
    AnalysisResult,
    DecisionStatus,
    GuardianDecision,
    RiskCheckResult,
    RiskChecks,
    RiskCheckStatus,
    RiskMetrics,
)
from policies.risk_policy import (
    MAX_CONCENTRATION_PERCENT,
    MAX_TRADE_EXPOSURE_PERCENT,
    FLAG_TRADE_EXPOSURE_PERCENT,
    FLAG_CONCENTRATION_PERCENT,
    evaluate_risk,
)
from services.alpaca_service import (
    get_account,
    get_positions,
    get_latest_price,
    _SNAPSHOT_CACHE,
)

logger = logging.getLogger("TradeGuardian.GuardianAgent")


def is_related_contract_or_asset(pos_sym: str, underlying_symbol: str) -> bool:
    """
    Check if a position symbol corresponds to the underlying stock or an OCC option
    contract derived from the underlying.
    Prevents false prefix matches (e.g. 'C' matching 'COIN' or 'CRM').
    """
    pos = pos_sym.strip().upper()
    und = underlying_symbol.strip().upper()

    if pos == und:
        return True

    # Handle crypto format variations (e.g. 'UNI/USD' vs 'UNIUSD')
    if pos.replace("/", "") == und.replace("/", ""):
        return True

    if pos.startswith(und) or pos.replace("/", "").startswith(und.replace("/", "")):
        suffix = pos[len(und):] if pos.startswith(und) else pos.replace("/", "")[len(und.replace("/", "")):]
        # Standard OCC option format: Root + 6-digit date (YYMMDD) + C/P + 8-digit strike
        if len(suffix) >= 7 and suffix[:6].isdigit() and suffix[6] in ("C", "P"):
            return True

    return False


def calculate_optimal_trade_size(
    symbol: str,
    price: float,
    account_equity: float = 100000.0,
    buying_power: float = 400000.0,
    existing_holdings_value: float = 0.0,
    target_risk_percent: float = 4.5,
) -> Union[int, float]:
    """
    Calculate an optimal, safe share/crypto quantity that guarantees compliance
    with TradeGuardian risk policies:
    - Single Trade Exposure strictly capped below warning threshold (FLAG_TRADE_EXPOSURE_PERCENT = 5.0%, targeting <= 4.8%).
    - Total Concentration in symbol strictly capped below FLAG_CONCENTRATION_PERCENT (10.0%, targeting <= 9.5%).
    - Solvency check against available buying power.
    - Fractional sizing for crypto (e.g. 0.05 BTC) to prevent huge exposure spikes.
    """
    if price <= 0:
        return 1

    equity = max(1000.0, account_equity)
    # Safe dollar budget for a single trade: must strictly be <= FLAG_TRADE_EXPOSURE_PERCENT - 0.2 (4.8%)
    # so that trade_exposure_percent never trips the 5.0% warning threshold!
    safe_target_pct = min(target_risk_percent, FLAG_TRADE_EXPOSURE_PERCENT - 0.2)
    max_trade_dollars = equity * (safe_target_pct / 100.0)

    # Safe dollar budget respecting existing portfolio concentration (under 10% flag threshold)
    safe_concentration_ceiling_pct = min(20.0, FLAG_CONCENTRATION_PERCENT - 0.5)
    concentration_ceiling_dollars = equity * (safe_concentration_ceiling_pct / 100.0)
    remaining_concentration_dollars = max(0.0, concentration_ceiling_dollars - existing_holdings_value)

    # Available cash / buying power headroom (max 85% of buying power)
    available_bp = max(0.0, buying_power * 0.85)

    safe_budget = min(max_trade_dollars, remaining_concentration_dollars, available_bp)

    is_crypto = "/" in symbol or symbol.endswith("USD") or symbol in {"BTCUSD", "ETHUSD", "SOLUSD", "DOGEUSD", "AVAXUSD"}

    if is_crypto:
        if safe_budget <= 0:
            return 0.001
        raw_qty = round(safe_budget / price, 4)
        return max(0.0001, raw_qty)

    if safe_budget <= 0:
        return 0

    raw_qty = int(safe_budget / price)
    # If price itself is higher than safe_budget, return 1 only if within MAX_TRADE_EXPOSURE_PERCENT
    if raw_qty < 1:
        if price <= equity * (MAX_TRADE_EXPOSURE_PERCENT / 100.0):
            return 1
        return 0

    return max(1, raw_qty)


def evaluate_trade(
    proposal: Union[AgentTradeProposal, TradeProposal, dict[str, Any]],
    account: Any = None,
    positions: list[Any] | None = None,
) -> AnalysisResult:
    """
    Evaluate a trade proposal (options contract, spot equity, or crypto) against
    TradeGuardian risk controls and Alpaca account limits.
    """
    # ---------------------------------------------------------
    # 1. Normalize proposal inputs (Options vs Equity vs Crypto vs Dict)
    # ---------------------------------------------------------
    underlying_symbol = "SPY"
    option_symbol = None
    side = "buy"
    quantity = 1.0
    price_or_premium = 1.0
    is_option = False
    strategy = "Guardian Risk Evaluation"
    raw_proposal_dict: dict[str, Any] = {}

    if isinstance(proposal, AgentTradeProposal):
        opt = proposal.option_contract
        underlying_symbol = opt.symbol.upper()
        option_symbol = opt.option_symbol.upper()
        side = "buy"  # Derivatives are buy to open
        quantity = float(opt.quantity)
        is_crypto = "/" in underlying_symbol or underlying_symbol.endswith("USD") or option_symbol.endswith("-SPOT")
        strategy = getattr(opt, "strategy", "Options Alpha Agent")
        if is_crypto:
            is_option = False
            price_or_premium = opt.strike_price
            # If spot crypto strategy is a sell/exit/short, evaluate as sell to trigger oversell audit
            if proposal.opportunity.direction == MarketDirection.BEARISH or "short" in strategy.lower() or "sell" in strategy.lower() or "hedge" in strategy.lower():
                side = "sell"
        else:
            price_or_premium = opt.estimated_premium
            is_option = True
        raw_proposal_dict = proposal.model_dump(mode="json")

    elif isinstance(proposal, TradeProposal):
        underlying_symbol = proposal.symbol.upper()
        side = proposal.side.value if hasattr(proposal.side, "value") else str(proposal.side).lower()
        quantity = proposal.quantity
        strategy = proposal.order_type or "Market Order"
        raw_proposal_dict = proposal.model_dump(mode="json")
        if proposal.entry_price and proposal.entry_price > 0:
            price_or_premium = proposal.entry_price
        else:
            try:
                price_or_premium = get_latest_price(underlying_symbol)
            except Exception as e:
                logger.warning(f"Live price lookup failed for {underlying_symbol}: {e}")
                cached = _SNAPSHOT_CACHE.get(underlying_symbol) or _SNAPSHOT_CACHE.get(underlying_symbol.replace("/", "")) or _SNAPSHOT_CACHE.get(f"{underlying_symbol[:-3]}/USD" if underlying_symbol.endswith("USD") else "")
                if cached and cached.get("price") and cached["price"] > 0:
                    price_or_premium = float(cached["price"])
                else:
                    price_or_premium = 100.0

    elif isinstance(proposal, dict):
        underlying_symbol = str(proposal.get("symbol", "SPY")).upper()
        option_symbol = proposal.get("option_symbol")
        if option_symbol:
            option_symbol = str(option_symbol).upper()
            is_option = True
        side = str(proposal.get("side", "buy")).lower()
        quantity = float(proposal.get("quantity", 1))
        strategy = str(proposal.get("strategy", "Direct Proposal"))
        raw_proposal_dict = dict(proposal)

        if "price" in proposal and float(proposal["price"]) > 0:
            price_or_premium = float(proposal["price"])
        elif "estimated_premium" in proposal and float(proposal["estimated_premium"]) > 0:
            price_or_premium = float(proposal["estimated_premium"])
            is_option = True
        elif "entry_price" in proposal and proposal["entry_price"] and float(proposal["entry_price"]) > 0:
            price_or_premium = float(proposal["entry_price"])
        else:
            try:
                price_or_premium = get_latest_price(underlying_symbol)
            except Exception as e:
                logger.warning(f"Live price lookup failed for dict proposal {underlying_symbol}: {e}")
                cached = _SNAPSHOT_CACHE.get(underlying_symbol) or _SNAPSHOT_CACHE.get(underlying_symbol.replace("/", "")) or _SNAPSHOT_CACHE.get(f"{underlying_symbol[:-3]}/USD" if underlying_symbol.endswith("USD") else "")
                if cached and cached.get("price") and cached["price"] > 0:
                    price_or_premium = float(cached["price"])
                else:
                    price_or_premium = 100.0

    # Calculate monetary trade cost
    if is_option:
        trade_cost = round(price_or_premium * 100.0 * quantity, 2)
    else:
        trade_cost = round(price_or_premium * quantity, 2)

    # ---------------------------------------------------------
    # 2. Fetch live Alpaca account & positions with fallback
    # ---------------------------------------------------------
    if account is None:
        try:
            account = get_account()
        except Exception as e:
            logger.warning(f"Could not fetch Alpaca account, using fallback: {e}")
            account = None

    account_equity = float(getattr(account, "equity", 100000.0))
    buying_power = float(getattr(account, "buying_power", 400000.0))

    pos_list: list[Any] = []
    if positions is not None and isinstance(positions, list):
        pos_list = positions
    else:
        try:
            fetched = get_positions()
            if isinstance(fetched, list):
                pos_list = fetched
            elif isinstance(fetched, dict) and "positions" in fetched:
                pos_list = fetched["positions"]
        except Exception as e:
            logger.warning(f"Could not fetch Alpaca positions, using empty fallback: {e}")
            pos_list = []

    # ---------------------------------------------------------
    # 3. Analyze existing positions and concentration
    # ---------------------------------------------------------
    existing_quantity = 0.0
    existing_position_value = 0.0

    target_contract = (option_symbol or underlying_symbol).upper()

    for pos in pos_list:
        pos_sym = str(getattr(pos, "symbol", "")).upper()
        # Check exact contract/asset match
        if pos_sym == target_contract:
            existing_quantity = abs(float(getattr(pos, "qty", 0.0)))

        # Aggregate all exposure to this underlying
        if is_related_contract_or_asset(pos_sym, underlying_symbol):
            existing_position_value += abs(float(getattr(pos, "market_value", 0.0)))

    # Calculate projected state
    is_sell = side == "sell"

    if is_sell:
        projected_quantity = max(0.0, existing_quantity - quantity)
        projected_position_value = max(0.0, round(existing_position_value - trade_cost, 2))
        trade_percent_of_equity = 0.0
    else:
        projected_quantity = existing_quantity + quantity
        projected_position_value = round(existing_position_value + trade_cost, 2)
        trade_percent_of_equity = round(
            (trade_cost / account_equity * 100.0) if account_equity > 0 else 100.0,
            2,
        )

    projected_concentration_percent = round(
        (projected_position_value / account_equity * 100.0) if account_equity > 0 else 100.0,
        2,
    )

    # ---------------------------------------------------------
    # 4. Guardian Risk Checks (4 Audits)
    # ---------------------------------------------------------

    # 1. Exposure Check (Single Trade Exposure <= 10%)
    if is_sell:
        exposure_status = RiskCheckStatus.PASS
        exposure_reason = "Sell order liquidates risk and incurs 0% new capital exposure."
    else:
        exposure_pass = trade_percent_of_equity <= MAX_TRADE_EXPOSURE_PERCENT
        exposure_status = RiskCheckStatus.PASS if exposure_pass else RiskCheckStatus.FAIL
        if exposure_pass:
            exposure_reason = f"Trade exposure is {trade_percent_of_equity:.2f}% of account equity (Limit: {MAX_TRADE_EXPOSURE_PERCENT:.1f}%)."
        else:
            exposure_reason = f"Trade exposure of {trade_percent_of_equity:.2f}% exceeds {MAX_TRADE_EXPOSURE_PERCENT:.1f}% limit."

    exposure_check = RiskCheckResult(
        status=exposure_status,
        reason=exposure_reason,
    )

    # 2. Concentration Check (Portfolio Underlying <= 25%)
    concentration_pass = projected_concentration_percent <= MAX_CONCENTRATION_PERCENT
    concentration_status = RiskCheckStatus.PASS if concentration_pass else RiskCheckStatus.FAIL
    if concentration_pass:
        concentration_reason = f"Projected concentration is {projected_concentration_percent:.2f}% of equity (Limit: {MAX_CONCENTRATION_PERCENT:.1f}%)."
    else:
        concentration_reason = f"Projected concentration of {projected_concentration_percent:.2f}% exceeds {MAX_CONCENTRATION_PERCENT:.1f}% limit."

    concentration_check = RiskCheckResult(
        status=concentration_status,
        reason=concentration_reason,
    )

    # 3. Buying Power Check (Solvency)
    if is_sell:
        buying_power_status = RiskCheckStatus.PASS
        buying_power_reason = "Sell orders release equity and require no additional buying power."
    else:
        buying_power_pass = trade_cost <= buying_power
        buying_power_status = RiskCheckStatus.PASS if buying_power_pass else RiskCheckStatus.FAIL
        if buying_power_pass:
            buying_power_reason = f"Trade requires ${trade_cost:,.2f}, within available buying power of ${buying_power:,.2f}."
        else:
            buying_power_reason = f"Trade requires ${trade_cost:,.2f}, exceeding available buying power of ${buying_power:,.2f}."

    buying_power_check = RiskCheckResult(
        status=buying_power_status,
        reason=buying_power_reason,
    )

    # 4. Position & Validation Check (Oversell & Contract Integrity)
    if is_sell:
        if quantity > existing_quantity:
            position_status = RiskCheckStatus.FAIL
            position_reason = f"Oversell Protection: Cannot sell {quantity} units. Only {existing_quantity} held in account."
        else:
            position_status = RiskCheckStatus.PASS
            position_reason = f"Sell verified: Liquidating {quantity} of {existing_quantity} held units."
    else:
        position_status = RiskCheckStatus.PASS
        if existing_quantity > 0:
            position_reason = f"Position scaling: Adding {quantity} units to existing {existing_quantity} (New total: {projected_quantity})."
        else:
            position_reason = f"Initial entry: Establishing new position of {quantity} units in {target_contract}."

    position_check = RiskCheckResult(
        status=position_status,
        reason=position_reason,
    )

    risk_checks = RiskChecks(
        exposure=exposure_check,
        concentration=concentration_check,
        buying_power=buying_power_check,
        position=position_check,
    )

    # ---------------------------------------------------------
    # 5. Guardian Policy Decision Synthesis
    # ---------------------------------------------------------
    if is_sell:
        if position_status == RiskCheckStatus.FAIL:
            decision = GuardianDecision(
                status=DecisionStatus.BLOCKED,
                reasons=[position_reason],
            )
        else:
            decision = GuardianDecision(
                status=DecisionStatus.APPROVED,
                reasons=["Sell order approved: Reduces risk exposure and complies with oversell guardrails."],
            )
    else:
        decision = evaluate_risk(
            trade_exposure_percent=trade_percent_of_equity,
            projected_concentration_percent=projected_concentration_percent,
        )

        # Enforce hard constraints (Buying Power & Position)
        if buying_power_status == RiskCheckStatus.FAIL or position_status == RiskCheckStatus.FAIL:
            reasons = list(decision.reasons)
            if buying_power_status == RiskCheckStatus.FAIL:
                reasons.insert(0, buying_power_reason)
            if position_status == RiskCheckStatus.FAIL:
                reasons.insert(0, position_reason)

            decision = GuardianDecision(
                status=DecisionStatus.BLOCKED,
                reasons=reasons,
            )

    # Calculate optimal safe quantity if order exceeds risk threshold or is blocked
    suggested_safe_qty = None
    if decision.status != DecisionStatus.APPROVED and side == "buy":
        suggested_safe_qty = calculate_optimal_trade_size(
            symbol=underlying_symbol,
            price=price_or_premium,
            account_equity=account_equity,
            buying_power=buying_power,
            existing_holdings_value=existing_position_value,
            target_risk_percent=4.5,
        )
        if suggested_safe_qty > 0 and suggested_safe_qty != quantity:
            reasons = list(decision.reasons)
            reasons.append(
                f"Guardian Sizing Proposal: Adjust order to {suggested_safe_qty} units "
                f"to comply with the 5.0% single-trade exposure threshold."
            )
            decision = GuardianDecision(
                status=decision.status,
                reasons=reasons,
            )

    # ---------------------------------------------------------
    # 6. Assemble Result & Persist Audit
    # ---------------------------------------------------------
    risk_metrics = RiskMetrics(
        existing_quantity=existing_quantity,
        projected_quantity=projected_quantity,
        account_equity=account_equity,
        buying_power=buying_power,
        trade_percent_of_equity=trade_percent_of_equity,
        existing_position_value=existing_position_value,
        projected_position_value=projected_position_value,
        projected_concentration_percent=projected_concentration_percent,
    )

    # Clean proposal dictionary for frontend
    clean_proposal = {
        "symbol": underlying_symbol,
        "option_symbol": option_symbol,
        "side": side,
        "quantity": quantity,
        "current_price": price_or_premium,
        "trade_value": trade_cost,
        "strategy": strategy,
        "suggested_safe_quantity": suggested_safe_qty,
    }

    result = AnalysisResult(
        audit_id=uuid4(),
        message="Trade proposal analyzed and certified by Guardian Agent.",
        proposal=clean_proposal,
        risk_metrics=risk_metrics,
        risk_checks=risk_checks,
        decision=decision,
    )

    # Save to history service if available
    try:
        from services.history_service import save_analysis
        save_analysis(result)
    except Exception as e:
        logger.debug(f"History service note: {e}")

    return result