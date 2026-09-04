import math
from concurrent.futures import (
    ThreadPoolExecutor,
    as_completed,
)
from models.agent import (
    MarketDirection,
    MarketOpportunity,
)
from services.alpaca_service import (
    POPULAR_MARKET_SYMBOLS,
    get_latest_price,
    get_market_bars,
)


# Broad liquid universe spanning major US sectors, indices, mega-tech, and market leaders
BROAD_LIQUID_MARKET_UNIVERSE = [
    "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA",
    "AMD", "AVGO", "INTC", "QCOM", "PLTR", "CRM", "ORCL",
    "COIN", "JPM", "BAC", "GS", "V", "WMT", "COST", "DIS",
    "UBER", "NFLX", "LLY", "UNH", "XOM",
    "SPY", "QQQ", "IWM", "DIA", "SMH",
]

CRYPTO_MARKET_UNIVERSE = [
    "BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD", "AVAX/USD",
]

DEFAULT_WATCHLIST = BROAD_LIQUID_MARKET_UNIVERSE


def _calculate_rsi(closes: list[float], period: int = 14) -> float:
    """Calculate 14-period Relative Strength Index (RSI)."""
    if len(closes) < period + 1:
        return 50.0

    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    recent_deltas = deltas[-period:]

    gains = [d for d in recent_deltas if d > 0]
    losses = [abs(d) for d in recent_deltas if d < 0]

    avg_gain = sum(gains) / period if gains else 0.0
    avg_loss = sum(losses) / period if losses else 0.0

    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0

    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1.0 + rs)), 1)


def _calculate_adx(bars: list[dict], period: int = 14) -> float:
    """Calculate 14-period Average Directional Index (ADX) measuring trend conviction."""
    if len(bars) < period + 2:
        return 22.0

    tr_list = []
    plus_dm = []
    minus_dm = []

    for i in range(1, len(bars)):
        high = float(bars[i].get("high", bars[i]["close"]))
        low = float(bars[i].get("low", bars[i]["close"]))
        prev_high = float(bars[i - 1].get("high", bars[i - 1]["close"]))
        prev_low = float(bars[i - 1].get("low", bars[i - 1]["close"]))
        prev_close = float(bars[i - 1]["close"])

        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        tr_list.append(tr)

        up_move = high - prev_high
        down_move = prev_low - low

        if up_move > down_move and up_move > 0:
            plus_dm.append(up_move)
        else:
            plus_dm.append(0.0)

        if down_move > up_move and down_move > 0:
            minus_dm.append(down_move)
        else:
            minus_dm.append(0.0)

    if len(tr_list) < period:
        return 22.0

    smooth_tr = sum(tr_list[-period:])
    smooth_pdm = sum(plus_dm[-period:])
    smooth_mdm = sum(minus_dm[-period:])

    if smooth_tr <= 0:
        return 20.0

    pdi = (smooth_pdm / smooth_tr) * 100.0
    mdi = (smooth_mdm / smooth_tr) * 100.0

    di_sum = pdi + mdi
    if di_sum <= 0:
        return 20.0

    dx = (abs(pdi - mdi) / di_sum) * 100.0
    return round(min(100.0, max(5.0, dx)), 1)


def _calculate_bollinger_z_score(
    closes: list[float],
    current_price: float,
    period: int = 20,
) -> tuple[float, float, float]:
    """
    Calculate 20-day SMA, 20-day Standard Deviation, and Z-Score (standard deviations from mean).
    Returns (sma20, std_dev, z_score).
    """
    if len(closes) < 5:
        return current_price, 0.0, 0.0

    window = closes[-min(period, len(closes)):]
    sma = sum(window) / len(window)
    variance = sum((x - sma) ** 2 for x in window) / len(window)
    std_dev = math.sqrt(variance)

    if std_dev <= 0:
        return sma, 0.0, 0.0

    z_score = round((current_price - sma) / std_dev, 2)
    return round(sma, 2), round(std_dev, 2), z_score


def analyze_symbol(
    symbol: str,
) -> MarketOpportunity | None:
    """
    Analyze a single symbol and detect a bullish or bearish momentum opportunity
    using multi-factor institutional technical analysis (MTF trend, ADX, Bollinger Z-score,
    VSA volume exhaustion, 30-day ROC, and regime classification).
    Overextended parabolic moves receive explicit penalties rather than inflated confidence.
    """
    symbol = symbol.strip().upper()

    # Fetch 3M daily bars (up to 90-120 bars) for multi-timeframe and 50-day SMA computation
    bars = get_market_bars(symbol, timeframe="3M")
    if not bars or len(bars) < 15:
        bars = get_market_bars(symbol, timeframe="1M")
    if not bars or len(bars) < 5:
        bars = get_market_bars(symbol, timeframe="1D")

    if not bars:
        return None

    current_price = bars[-1]["close"]
    try:
        from services.alpaca_service import _SNAPSHOT_CACHE
        cached = _SNAPSHOT_CACHE.get(symbol)
        if cached and cached.get("price") and cached["price"] > 0:
            current_price = float(cached["price"])
    except Exception:
        pass

    if not current_price or current_price <= 0:
        return None

    closes = [float(bar["close"]) for bar in bars] if bars else []
    volumes = [float(bar.get("volume", 0)) for bar in bars] if bars else []

    is_crypto = "/" in symbol or symbol.endswith("USD")

    # 1. Multi-Timeframe Moving Averages & Statistical Z-Score
    if len(closes) >= 5:
        sma5 = sum(closes[-5:]) / 5.0
        sma20, std20, z_score_20d = _calculate_bollinger_z_score(closes, current_price, period=20)
        sma50 = (sum(closes[-50:]) / 50.0) if len(closes) >= 35 else sma20
        rsi = _calculate_rsi(closes, period=min(14, len(closes) - 1))
        adx = _calculate_adx(bars, period=14)

        # 30-day Macro Rate-of-Change (ROC)
        lookback_30d = min(30, len(closes))
        base_30d = closes[-lookback_30d]
        roc_30d = round(((current_price - base_30d) / base_30d) * 100.0, 1) if base_30d > 0 else 0.0

        # Distance from key baselines
        pct_from_sma20 = round(((current_price - sma20) / sma20) * 100.0, 1) if sma20 > 0 else 0.0
        pct_from_sma50 = round(((current_price - sma50) / sma50) * 100.0, 1) if sma50 > 0 else 0.0
        pct_from_sma5 = round(((current_price - sma5) / sma5) * 100.0, 1) if sma5 > 0 else 0.0

        # 2. Volume Spread Analysis (VSA) & Institutional Footprint
        if len(volumes) >= 5 and sum(volumes[-5:]) > 0:
            avg_vol = sum(volumes[-min(20, len(volumes)):]) / min(20, len(volumes))
            latest_vol = volumes[-1] if volumes[-1] > 0 else avg_vol
            vol_ratio = round(latest_vol / max(1.0, avg_vol), 2)
            avg_vol_5d = sum(volumes[-5:]) / 5.0
        else:
            vol_ratio = 1.0
            avg_vol_5d = 1.0
            avg_vol = 1.0
    else:
        sma5 = current_price
        sma20 = current_price
        sma50 = current_price
        std20 = 0.0
        z_score_20d = 0.0
        roc_30d = 0.0
        pct_from_sma20 = 0.0
        pct_from_sma50 = 0.0
        pct_from_sma5 = 0.0
        rsi = 50.0
        adx = 22.0
        vol_ratio = 1.0
        avg_vol_5d = 1.0
        avg_vol = 1.0

    # Trend Directional Bias
    is_bullish = current_price >= sma20 and (current_price >= sma5 or pct_from_sma20 > 0.0)

    # 3. Volume Trend (VSA)
    if is_bullish and z_score_20d >= 1.6 and avg_vol_5d < (0.85 * avg_vol):
        volume_trend = "EXHAUSTION"  # Price pushing up but institutional buyers thinning
    elif is_bullish and vol_ratio >= 1.3:
        volume_trend = "ACCUMULATION"
    elif not is_bullish and vol_ratio >= 1.3:
        volume_trend = "DISTRIBUTION"
    elif vol_ratio >= 1.1:
        volume_trend = "EXPANSION"
    else:
        volume_trend = "NORMAL"

    # 4. Market Regime & Overextension Detection
    overextended_pct = 6.0 if is_crypto else 4.5
    overextended_roc = 22.0 if is_crypto else 15.0
    pullback_support_price = round(sma20, 2 if current_price >= 10 else 4)

    is_overextended = False
    if is_bullish and (pct_from_sma20 > overextended_pct or roc_30d > overextended_roc or z_score_20d >= 2.0):
        market_regime = "OVEREXTENDED_MOMENTUM"
        is_overextended = True
    elif adx < 20.0:
        market_regime = "RANGING_CHOP"
    elif is_bullish and 0.0 <= pct_from_sma20 <= 2.8 and current_price >= sma20:
        market_regime = "PULLBACK_ENTRY"
    elif vol_ratio >= 1.35 and abs(pct_from_sma20) <= 3.5:
        market_regime = "SQUEEZE_BREAKOUT"
    else:
        market_regime = "TREND_CONTINUATION"

    # 5. Multi-Factor Quantitative Scoring (Dynamic between 42% and 92%)
    score = 54.0

    # Trend Alignment Factor (up to 16 pts)
    if is_bullish:
        if current_price > sma20 > sma50:
            score += 16.0  # Multi-timeframe trend alignment
        elif current_price > sma20:
            score += 9.0
    else:
        if current_price < sma20 < sma50:
            score += 16.0
        elif current_price < sma20:
            score += 9.0

    # ADX Trend Strength Factor (up to 10 pts)
    if 24.0 <= adx <= 38.0:
        score += 10.0  # Strong sustainable trend
    elif adx > 38.0:
        score += 3.0   # Overheated / climax trend
    elif adx < 20.0:
        score -= 8.0   # Choppy trendless market penalty

    # Momentum & RSI Factor (up to 12 pts)
    if is_bullish:
        if 50.0 <= rsi <= 64.0:
            score += 12.0  # Prime constructive momentum
        elif 64.0 < rsi <= 72.0:
            score += 5.0   # Moderately overbought
        elif rsi > 72.0:
            score -= 12.0  # Heavy overbought penalty
    else:
        if 36.0 <= rsi <= 50.0:
            score += 12.0
        elif rsi < 28.0:
            score -= 12.0  # Oversold exhaustion penalty

    # Market Regime & Overextension Penalty (CRITICAL FIX: Penalize parabolic extensions)
    if market_regime == "PULLBACK_ENTRY":
        score += 14.0  # High-probability low-risk entry at 20-SMA support
    elif market_regime == "SQUEEZE_BREAKOUT":
        score += 10.0  # Volatility expansion
    elif market_regime == "OVEREXTENDED_MOMENTUM":
        score -= 22.0  # HEAVY PENALTY: Prevents high confidence on chasing vertical tops!
    elif market_regime == "RANGING_CHOP":
        score -= 10.0

    # Volume Factor & VSA Exhaustion
    if volume_trend == "ACCUMULATION":
        score += 8.0
    elif volume_trend == "EXHAUSTION":
        score -= 10.0  # Volume divergence penalty
    elif vol_ratio >= 1.1:
        score += 4.0

    confidence = round(max(42.0, min(92.0, score)), 1)

    # 6. Dynamic Volatility & Technical Support/Resistance SL/TP Calculation
    trs = []
    for i in range(1, len(bars)):
        h = float(bars[i].get("high", bars[i]["close"]))
        l = float(bars[i].get("low", bars[i]["close"]))
        prev_c = float(bars[i - 1]["close"])
        tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        trs.append(tr)
    atr = (sum(trs[-14:]) / min(14, len(trs))) if trs else (current_price * 0.028)
    atr_pct = (atr / current_price) * 100 if current_price > 0 else 2.8

    # Calculate invalidation stop and asymmetric target yield (1:2.2 to 1:2.6 R:R)
    rr_ratio = round(2.2 + max(0.0, (confidence - 50.0) / 100.0), 1)

    if is_bullish:
        if sma20 < current_price:
            dist_to_sma20 = ((current_price - sma20) / current_price) * 100
            if 1.0 <= dist_to_sma20 <= 4.5:
                raw_sl = dist_to_sma20 + (0.35 * atr_pct)
            else:
                raw_sl = 1.35 * atr_pct
        else:
            raw_sl = 1.35 * atr_pct

        sl_pct = round(max(2.5, min(5.5, raw_sl)) if is_crypto else max(1.8, min(4.2, raw_sl)), 1)
        tp_pct = round(sl_pct * rr_ratio, 1)

        sl_price = round(current_price * (1.0 - sl_pct / 100.0), 2 if current_price >= 10 else 4)
        tp_price = round(current_price * (1.0 + tp_pct / 100.0), 2 if current_price >= 10 else 4)
    else:
        if sma20 > current_price:
            dist_to_sma20 = ((sma20 - current_price) / current_price) * 100
            if 1.0 <= dist_to_sma20 <= 4.5:
                raw_sl = dist_to_sma20 + (0.35 * atr_pct)
            else:
                raw_sl = 1.35 * atr_pct
        else:
            raw_sl = 1.35 * atr_pct

        sl_pct = round(max(2.5, min(5.5, raw_sl)) if is_crypto else max(1.8, min(4.2, raw_sl)), 1)
        tp_pct = round(sl_pct * rr_ratio, 1)

        sl_price = round(current_price * (1.0 + sl_pct / 100.0), 2 if current_price >= 10 else 4)
        tp_price = round(current_price * (1.0 - tp_pct / 100.0), 2 if current_price >= 10 else 4)

    sl_fmt = f"${sl_price:,.2f}" if current_price >= 10 else f"${sl_price:.4f}"
    tp_fmt = f"${tp_price:,.2f}" if current_price >= 10 else f"${tp_price:.4f}"

    # 7. Actuarial Probabilistic Expected Value (EV)
    win_prob = 0.65 if market_regime == "PULLBACK_ENTRY" else (
        0.58 if market_regime == "SQUEEZE_BREAKOUT" else (
            0.52 if market_regime == "TREND_CONTINUATION" else (
                0.35 if market_regime == "OVEREXTENDED_MOMENTUM" else 0.40
            )
        )
    )
    risk_dollars = round(current_price * (sl_pct / 100.0), 2)
    reward_dollars = round(current_price * (tp_pct / 100.0), 2)
    expected_val = round((win_prob * reward_dollars) - ((1.0 - win_prob) * risk_dollars), 2)

    # 8. Institutional Multi-Dimensional Reasoning Synthesizer
    reasoning = []
    direction = MarketDirection.BULLISH if is_bullish else MarketDirection.BEARISH

    if is_overextended:
        reasoning.append(
            f"⚠️ Overextension Alert: Asset surged {roc_30d:+.1f}% over 30 days and sits {pct_from_sma20:+.1f}% above 20-day SMA (${sma20:,.2f}) with Z-Score +{z_score_20d:.1f}σ."
        )
        reasoning.append(
            f"Mean-Reversion Risk: Elevated probability of a pullback retesting 20-day SMA support (${pullback_support_price:,.2f})."
        )
    elif market_regime == "PULLBACK_ENTRY":
        reasoning.append(
            f"Prime Pullback Setup: Price ${current_price:,.2f} is testing 20-day SMA dynamic support (${sma20:,.2f}, {pct_from_sma20:+.1f}% distance) with 50-day SMA at ${sma50:,.2f}."
        )
    elif market_regime == "SQUEEZE_BREAKOUT":
        reasoning.append(
            f"Volatility Squeeze: Expanding breakout with volume ratio {vol_ratio:.2f}x of 20-day average."
        )
    elif is_bullish:
        reasoning.append(
            f"Trend Structure: Price ${current_price:,.2f} holding {pct_from_sma20:+.1f}% vs 20-day SMA (${sma20:,.2f}) and {pct_from_sma50:+.1f}% vs 50-day SMA (${sma50:,.2f})."
        )
    else:
        reasoning.append(
            f"Bearish Structure: Price ${current_price:,.2f} trading {pct_from_sma20:+.1f}% below 20-day SMA (${sma20:,.2f}) with downward distribution."
        )

    reasoning.append(
        f"Regime & Momentum: {market_regime.replace('_', ' ')} (ADX {adx:.1f}), RSI(14) at {rsi:.1f}, 30D Velocity {roc_30d:+.1f}%."
    )

    if volume_trend == "EXHAUSTION":
        reasoning.append("VSA Warning: Volume divergence detected (price pressing high on declining 5-day volume).")
    elif volume_trend == "ACCUMULATION":
        reasoning.append(f"Institutional Accumulation: Volume confirmed at {vol_ratio:.2f}x 20-day average.")

    reasoning.append(
        f"Guardian Risk Target: Stop-Loss at {sl_fmt} (-{sl_pct}%) with asymmetric 1:{rr_ratio:.1f} Take-Profit at {tp_fmt} (+{tp_pct}%)."
    )

    return MarketOpportunity(
        symbol=symbol,
        direction=direction,
        confidence=confidence,
        current_price=round(current_price, 4 if current_price < 1.0 else 2),
        reasoning=reasoning,
        rvol=vol_ratio,
        asset_class="crypto" if is_crypto else "us_equity",
        atr=round(atr, 4),
        suggested_sl_price=sl_price,
        suggested_tp_price=tp_price,
        suggested_sl_pct=sl_pct,
        suggested_tp_pct=tp_pct,
        risk_reward_ratio=rr_ratio,
        roc_30d=roc_30d,
        sma50=round(sma50, 2 if current_price >= 10 else 4),
        pct_from_sma20=pct_from_sma20,
        pct_from_sma50=pct_from_sma50,
        z_score_20d=z_score_20d,
        adx=adx,
        market_regime=market_regime,
        is_overextended=is_overextended,
        volume_trend=volume_trend,
        pullback_support_price=pullback_support_price,
        expected_value=expected_val,
    )


def scan_market(
    symbols: list[str] | None = None,
) -> list[MarketOpportunity]:
    """
    Scan a market universe concurrently in parallel and return detected
    opportunities ranked by confidence. NO artificial truncations.
    """
    watchlist = (
        symbols
        if symbols is not None and len(symbols) > 0
        else DEFAULT_WATCHLIST
    )

    opportunities = []

    # Parallelize analysis across symbols with throttled concurrency (4 workers) to respect Alpaca rate limits
    max_workers = min(len(watchlist), 4)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_symbol = {
            executor.submit(analyze_symbol, s): s
            for s in watchlist
        }

        for future in as_completed(future_to_symbol):
            symbol = future_to_symbol[future]
            try:
                opportunity = future.result()
                if opportunity is not None:
                    opportunities.append(opportunity)
            except Exception as error:
                print(f"Research agent failed for {symbol}: {error}")

    # Sort strictly by technical confidence descending
    return sorted(
        opportunities,
        key=lambda opportunity: opportunity.confidence,
        reverse=True,
    )


def get_unified_deep_scan_universe(force_refresh: bool = False) -> list[str]:
    """
    Construct the unified multi-asset deep scan universe combining:
    1. Dynamic high-volume & momentum breakout candidates discovered by screener_service
    2. 24/7 liquid crypto leaders (CRYPTO_MARKET_UNIVERSE)
    3. Benchmark US equity & ETF anchors (BROAD_LIQUID_MARKET_UNIVERSE)
    Deduplicates symbols while prioritizing active dynamic movers.
    """
    from services.screener_service import get_dynamic_high_volume_candidates

    dynamic_candidates = get_dynamic_high_volume_candidates(
        limit=25,
        min_rvol=1.0,
        include_crypto=True,
        force_refresh=force_refresh,
    )
    dynamic_syms = [c["symbol"] for c in dynamic_candidates]

    # Combined priority order: Dynamic movers -> Crypto leaders -> Core benchmarks
    combined: list[str] = []
    seen: set[str] = set()

    for sym in dynamic_syms + CRYPTO_MARKET_UNIVERSE + BROAD_LIQUID_MARKET_UNIVERSE:
        clean = sym.strip().upper()
        if clean not in seen:
            seen.add(clean)
            combined.append(clean)

    return combined


def scan_dynamic_market(
    limit: int = 18,
    min_rvol: float = 1.0,
    include_crypto: bool = True,
    force_refresh: bool = False,
) -> list[MarketOpportunity]:
    """
    Scan dynamic high-volume and momentum candidates discovered by the screener service.
    """
    from services.screener_service import get_dynamic_high_volume_candidates

    candidates = get_dynamic_high_volume_candidates(
        limit=limit,
        min_rvol=min_rvol,
        include_crypto=include_crypto,
        force_refresh=force_refresh,
    )
    syms = [c["symbol"] for c in candidates] if candidates else DEFAULT_WATCHLIST[:limit]
    return scan_market(symbols=syms)