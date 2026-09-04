from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
import threading
import time
from typing import Any

from services.alpaca_service import (
    _SNAPSHOT_CACHE,
    get_latest_price,
    get_market_bars,
    stock_data_client,
    crypto_data_client,
)

logger = logging.getLogger("TradeGuardian.Screener")

# Broad institutional candidate pool spanning high-beta tech, volume leaders, index ETFs, and crypto
EXPANDED_CANDIDATE_POOL = [
    # Mega-Cap Tech & High-Beta Momentum
    {"symbol": "NVDA", "name": "NVIDIA Corp.", "asset_class": "us_equity"},
    {"symbol": "TSLA", "name": "Tesla Inc.", "asset_class": "us_equity"},
    {"symbol": "AAPL", "name": "Apple Inc.", "asset_class": "us_equity"},
    {"symbol": "MSFT", "name": "Microsoft Corp.", "asset_class": "us_equity"},
    {"symbol": "AMZN", "name": "Amazon.com Inc.", "asset_class": "us_equity"},
    {"symbol": "META", "name": "Meta Platforms", "asset_class": "us_equity"},
    {"symbol": "GOOGL", "name": "Alphabet Inc.", "asset_class": "us_equity"},
    {"symbol": "AMD", "name": "Advanced Micro Devices", "asset_class": "us_equity"},
    {"symbol": "AVGO", "name": "Broadcom Inc.", "asset_class": "us_equity"},
    {"symbol": "ARM", "name": "Arm Holdings", "asset_class": "us_equity"},
    {"symbol": "SMCI", "name": "Super Micro Computer", "asset_class": "us_equity"},
    {"symbol": "PLTR", "name": "Palantir Technologies", "asset_class": "us_equity"},
    {"symbol": "COIN", "name": "Coinbase Global", "asset_class": "us_equity"},
    {"symbol": "NFLX", "name": "Netflix Inc.", "asset_class": "us_equity"},
    {"symbol": "UBER", "name": "Uber Technologies", "asset_class": "us_equity"},
    {"symbol": "CRM", "name": "Salesforce Inc.", "asset_class": "us_equity"},
    {"symbol": "ORCL", "name": "Oracle Corp.", "asset_class": "us_equity"},
    {"symbol": "INTC", "name": "Intel Corp.", "asset_class": "us_equity"},
    {"symbol": "QCOM", "name": "Qualcomm Inc.", "asset_class": "us_equity"},
    # Finance, Energy, Industrials
    {"symbol": "JPM", "name": "JPMorgan Chase", "asset_class": "us_equity"},
    {"symbol": "BAC", "name": "Bank of America", "asset_class": "us_equity"},
    {"symbol": "GS", "name": "Goldman Sachs Group", "asset_class": "us_equity"},
    {"symbol": "XOM", "name": "Exxon Mobil Corp.", "asset_class": "us_equity"},
    {"symbol": "BA", "name": "Boeing Co.", "asset_class": "us_equity"},
    {"symbol": "DIS", "name": "Walt Disney Co.", "asset_class": "us_equity"},
    # Core Indices & Sector ETFs
    {"symbol": "SPY", "name": "SPDR S&P 500 ETF", "asset_class": "us_equity"},
    {"symbol": "QQQ", "name": "Invesco QQQ Trust", "asset_class": "us_equity"},
    {"symbol": "IWM", "name": "iShares Russell 2000", "asset_class": "us_equity"},
    {"symbol": "SMH", "name": "VanEck Semiconductor ETF", "asset_class": "us_equity"},
    {"symbol": "XLF", "name": "Financial Select Sector SPDR", "asset_class": "us_equity"},
    # Crypto Benchmark Leaders
    {"symbol": "BTC/USD", "name": "Bitcoin", "asset_class": "crypto"},
    {"symbol": "ETH/USD", "name": "Ethereum", "asset_class": "crypto"},
    {"symbol": "SOL/USD", "name": "Solana", "asset_class": "crypto"},
    {"symbol": "DOGE/USD", "name": "Dogecoin", "asset_class": "crypto"},
    {"symbol": "AVAX/USD", "name": "Avalanche", "asset_class": "crypto"},
]

_SCREENER_CACHE: list[dict[str, Any]] = []
_SCREENER_CACHE_TIME: float = 0.0
_SCREENER_LOCK = threading.Lock()
SCREENER_CACHE_TTL = 300  # 5 minutes


def _evaluate_candidate(item: dict[str, Any], min_rvol: float) -> dict[str, Any] | None:
    sym = item["symbol"]
    try:
        # Pacing delay to avoid burst rate limits across worker threads
        time.sleep(0.04)
        bars = get_market_bars(sym, timeframe="1M")
        if not bars or len(bars) < 5:
            return None

        current_price = bars[-1]["close"]
        volumes = [b.get("volume", 0) for b in bars]
        closes = [b["close"] for b in bars]

        # 20-period average volume baseline
        avg_vol = sum(volumes[-min(20, len(volumes)):]) / min(20, len(volumes))
        latest_vol = volumes[-1] if volumes[-1] > 0 else avg_vol
        rvol = round(latest_vol / max(1.0, avg_vol), 2)

        # Price change % over last bar
        prev_close = closes[-2] if len(closes) >= 2 else current_price
        price_change_pct = round(((current_price - prev_close) / max(0.01, prev_close)) * 100, 2)

        # Minimum RVol filter
        if rvol < min_rvol:
            # Still allow high percentage movers even if RVol is near baseline
            if abs(price_change_pct) < 1.5:
                return None

        # Momentum / Breakout Score = RVol * (1.0 + |Change%| * 0.15)
        momentum_score = round(rvol * (1.0 + abs(price_change_pct) * 0.15), 2)

        return {
            "symbol": sym,
            "name": item["name"],
            "asset_class": item["asset_class"],
            "price": current_price,
            "change_pct": price_change_pct,
            "rvol": rvol,
            "momentum_score": momentum_score,
        }
    except Exception as err:
        logger.debug(f"Screener evaluation note for {sym}: {err}")
        return None


def get_dynamic_high_volume_candidates(
    limit: int = 18,
    min_rvol: float = 1.0,
    include_crypto: bool = True,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    """
    Dynamically screens the market candidate pool for assets experiencing
    elevated relative volume (RVol), price expansion, and institutional momentum.
    Combines both high-beta US equities and liquid 24/7 crypto leaders with rate-limit protection.
    """
    global _SCREENER_CACHE, _SCREENER_CACHE_TIME

    now = time.time()
    with _SCREENER_LOCK:
        if not force_refresh and _SCREENER_CACHE and (now - _SCREENER_CACHE_TIME < SCREENER_CACHE_TTL):
            return _SCREENER_CACHE[:limit]

    pool = [
        item for item in EXPANDED_CANDIDATE_POOL
        if include_crypto or item["asset_class"] != "crypto"
    ]

    candidates = []
    # Moderate concurrency (4 workers) to respect Alpaca's 200 req/min rate limit
    max_workers = min(len(pool), 4)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_item = {
            executor.submit(_evaluate_candidate, item, min_rvol): item
            for item in pool
        }
        for future in as_completed(future_to_item):
            res = future.result()
            if res is not None:
                candidates.append(res)

    if candidates:
        # Sort descending by institutional momentum score
        ranked = sorted(candidates, key=lambda c: c["momentum_score"], reverse=True)
        with _SCREENER_LOCK:
            _SCREENER_CACHE = ranked
            _SCREENER_CACHE_TIME = time.time()
        return ranked[:limit]

    # Fallback to previously cached candidates if any API throttling occurred
    with _SCREENER_LOCK:
        if _SCREENER_CACHE:
            return _SCREENER_CACHE[:limit]

    return []
