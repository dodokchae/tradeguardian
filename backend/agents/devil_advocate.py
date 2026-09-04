from models.agent import (
    DevilAdvocateReview,
    MarketDirection,
    MarketOpportunity,
)


def review_opportunity(
    opportunity: MarketOpportunity,
) -> DevilAdvocateReview:
    """
    Quantitative adversarial stress-testing.
    Challenges directional theses by identifying concrete structural failure modes:
    macro parabolic overextension, mean-reversion drawdowns, liquidity sweeps,
    and volume divergence.
    """
    concerns = []
    risk_score = 25.0
    symbol = opportunity.symbol
    cur_price = opportunity.current_price
    roc = opportunity.roc_30d or 0.0
    pct_sma20 = opportunity.pct_from_sma20 or 0.0
    pct_sma50 = opportunity.pct_from_sma50 or 0.0
    regime = opportunity.market_regime or "TREND_CONTINUATION"
    vol_trend = opportunity.volume_trend or "NORMAL"
    pullback_sup = opportunity.pullback_support_price or cur_price
    sl_pct = opportunity.suggested_sl_pct or 3.5
    sl_price = opportunity.suggested_sl_price or (cur_price * 0.96)
    adx = opportunity.adx or 25.0

    # 1. Overextension & Parabolic Velocity Stress Test
    if opportunity.is_overextended or regime == "OVEREXTENDED_MOMENTUM":
        risk_score += 35.0
        z_score = getattr(opportunity, "z_score_20d", 2.0) or 2.0
        concerns.append(
            f"Macro Parabolic Overextension: {symbol} surged {roc:+.1f}% over 30 days and sits {pct_sma20:+.1f}% above its 20-day SMA with Z-Score +{z_score:.1f}σ."
        )
        concerns.append(
            f"Mean-Reversion Pullback Vulnerability: High probability of a -{pct_sma20:.1f}% mean-reversion flush retesting 20-day SMA support (${pullback_sup:,.2f})."
        )
        concerns.append(
            f"Stop-Loss Swept in Noise: Proposed {sl_pct:.1f}% Stop-Loss (${sl_price:,.2f}) sits directly inside the normal retest path and will likely be triggered before trend continuation."
        )

    # 2. Volume Spread Analysis (VSA) Exhaustion Test
    if vol_trend == "EXHAUSTION":
        risk_score += 20.0
        concerns.append(
            "Volume Divergence: Price is pressing new highs on declining 5-day volume, signaling institutional buyer exhaustion and distribution into retail momentum."
        )

    # 3. Choppy / Low ADX Regime Test
    if regime == "RANGING_CHOP" or adx < 20.0:
        risk_score += 22.0
        concerns.append(
            f"Chop Regime Alert (ADX {adx:.1f}): Trend conviction is weak (<20). Momentum breakouts in range-bound chop suffer a >65% historical failure rate."
        )

    # 4. Asymmetric Extension from 50-day SMA
    if abs(pct_sma50) > 18.0:
        risk_score += 15.0
        concerns.append(
            f"Macro Moving Average Stretch: Price is {pct_sma50:+.1f}% distant from its 50-day institutional baseline (${opportunity.sma50:,.2f}), representing an extended rubber-band condition."
        )

    # 5. Favorable Structural Setup Confirmation
    if regime == "PULLBACK_ENTRY" and not opportunity.is_overextended:
        concerns.append(
            f"Favorable Structural Anchor: Entering on a healthy pullback near 20-day SMA support (${pullback_sup:,.2f}). Risk is cleanly bounded by 50-day SMA (${opportunity.sma50:,.2f})."
        )
        risk_score = max(20.0, risk_score - 15.0)

    risk_score = min(100.0, max(15.0, risk_score))

    # Formulate Executive Adversarial Verdict & Actionable Recommendation
    if risk_score >= 60.0 or opportunity.is_overextended:
        adversarial_verdict = "CAUTION_OVEREXTENDED"
        approved = False
        recommendation = (
            f"Advisory Warning: Do NOT chase momentum at current highs. "
            f"Wait for consolidation or a mean-reversion retest of ${pullback_sup:,.2f} support before committing capital."
        )
    elif regime == "RANGING_CHOP":
        adversarial_verdict = "CHOPPY_REGIME_CAUTION"
        approved = True
        recommendation = (
            f"Caution: ADX {adx:.1f} signals choppy market conditions. Use tight profit targets or delta-neutral spreads."
        )
    elif regime == "PULLBACK_ENTRY":
        adversarial_verdict = "APPROVED_FAVORABLE_STRUCTURE"
        approved = True
        recommendation = (
            f"Approved: Prime dip-buying structure at 20-day SMA (${pullback_sup:,.2f}) with well-defined invalidation."
        )
    else:
        adversarial_verdict = "APPROVED_WITH_STANDARD_RISK"
        approved = True
        recommendation = (
            "Approved: Trend structure is valid. Enforce Guardian Stop-Loss and position limits."
        )

    return DevilAdvocateReview(
        approved=approved,
        risk_score=round(risk_score, 1),
        concerns=concerns,
        recommendation=recommendation,
        adversarial_verdict=adversarial_verdict,
    )