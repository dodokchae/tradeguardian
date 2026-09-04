import calendar
from alpaca.data.enums import OptionsFeed
from alpaca.trading.client import TradingClient
from core.config import ALPACA_API_KEY, ALPACA_SECRET_KEY

from alpaca.data.live.stock import StockDataStream
from alpaca.data.enums import DataFeed
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.historical.option import (
    OptionHistoricalDataClient,
)
from alpaca.data.requests import (
    OptionChainRequest,
    OptionSnapshotRequest,
    OptionLatestTradeRequest,
    OptionLatestQuoteRequest,
    StockLatestTradeRequest,
    StockLatestQuoteRequest,
)
from alpaca.data import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import (
    TimeFrame,
    TimeFrameUnit,
)
from alpaca.trading.enums import ContractType, OrderSide, TimeInForce, AssetStatus
from alpaca.trading.requests import (
    ClosePositionRequest,
    GetOptionContractsRequest,
    GetAssetsRequest,
    MarketOrderRequest,
    LimitOrderRequest,
)
from datetime import datetime, timedelta, timezone
from typing import Any, TypedDict


class TimeframeConfig(TypedDict):
    alpaca_timeframe: TimeFrame
    days: int

trading_client = TradingClient(
    api_key=ALPACA_API_KEY,
    secret_key=ALPACA_SECRET_KEY,
    paper=True,
)
stock_data_client = StockHistoricalDataClient(
    ALPACA_API_KEY,
    ALPACA_SECRET_KEY,
)
option_data_client = OptionHistoricalDataClient(
    ALPACA_API_KEY,
    ALPACA_SECRET_KEY,
)
stock_stream = StockDataStream(
    ALPACA_API_KEY,
    ALPACA_SECRET_KEY,
    feed=DataFeed.IEX,
)

import time
import threading
import concurrent.futures
import logging
from alpaca.data.historical import CryptoHistoricalDataClient
from alpaca.data.requests import (
    StockSnapshotRequest,
    CryptoSnapshotRequest,
    CryptoLatestTradeRequest,
    CryptoLatestQuoteRequest,
    CryptoBarsRequest,
)

logger = logging.getLogger("TradeGuardian.Alpaca")

crypto_data_client = CryptoHistoricalDataClient(
    ALPACA_API_KEY,
    ALPACA_SECRET_KEY,
)

_SNAPSHOT_CACHE: dict[str, dict] = {}
_SNAPSHOT_CACHE_TIME: float = 0.0

import random
_BARS_CACHE: dict[str, tuple[float, list[dict]]] = {}
_BARS_CACHE_LOCK = threading.Lock()
_BARS_LAST_REQ_TIME: float = 0.0
_BARS_REQ_LOCK = threading.Lock()

POPULAR_MARKET_SYMBOLS = [
    {"symbol": "AAPL", "name": "Apple Inc.", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "NVDA", "name": "NVIDIA Corporation", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "TSLA", "name": "Tesla, Inc.", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "MSFT", "name": "Microsoft Corporation", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "AMZN", "name": "Amazon.com, Inc.", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "GOOGL", "name": "Alphabet Inc.", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "META", "name": "Meta Platforms, Inc.", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "AMD", "name": "Advanced Micro Devices", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "NFLX", "name": "Netflix, Inc.", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "AVGO", "name": "Broadcom Inc.", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "INTC", "name": "Intel Corporation", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "PLTR", "name": "Palantir Technologies", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "COIN", "name": "Coinbase Global, Inc.", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "SPY", "name": "SPDR S&P 500 ETF Trust", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "QQQ", "name": "Invesco QQQ Trust", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "IWM", "name": "iShares Russell 2000 ETF", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "DIA", "name": "SPDR Dow Jones Industrial Average ETF", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "SMH", "name": "VanEck Semiconductor ETF", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "SOXX", "name": "iShares Semiconductor ETF", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "XLK", "name": "Technology Select Sector SPDR Fund", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "XLE", "name": "Energy Select Sector SPDR Fund", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "XLF", "name": "Financial Select Sector SPDR Fund", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "XLV", "name": "Health Care Select Sector SPDR Fund", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "XLI", "name": "Industrial Select Sector SPDR Fund", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "XLY", "name": "Consumer Discretionary SPDR Fund", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "XLP", "name": "Consumer Staples Select Sector SPDR", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "XBI", "name": "SPDR S&P Biotech ETF", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "ARKK", "name": "ARK Innovation ETF", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "TQQQ", "name": "ProShares UltraPro QQQ (3x)", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "SQQQ", "name": "ProShares UltraPro Short QQQ (-3x)", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "SOXL", "name": "Direxion Daily Semiconductor Bull 3X", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "SOXS", "name": "Direxion Daily Semiconductor Bear 3X", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "TSM", "name": "Taiwan Semiconductor Mfg Co", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "ASML", "name": "ASML Holding N.V.", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "ARM", "name": "Arm Holdings plc", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "SMCI", "name": "Super Micro Computer, Inc.", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "LLY", "name": "Eli Lilly and Company", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "UNH", "name": "UnitedHealth Group Inc.", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "XOM", "name": "Exxon Mobil Corporation", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "COST", "name": "Costco Wholesale Corporation", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "MU", "name": "Micron Technology, Inc.", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "QCOM", "name": "QUALCOMM Incorporated", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "TXN", "name": "Texas Instruments Inc", "exchange": "NASDAQ", "asset_class": "us_equity"},
    {"symbol": "VXX", "name": "iPath Series B S&P 500 VIX", "exchange": "BATS", "asset_class": "us_equity"},
    {"symbol": "JPM", "name": "JPMorgan Chase & Co.", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "BAC", "name": "Bank of America Corp", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "GS", "name": "Goldman Sachs Group Inc", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "V", "name": "Visa Inc.", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "WMT", "name": "Walmart Inc.", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "DIS", "name": "The Walt Disney Company", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "BA", "name": "Boeing Co.", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "UBER", "name": "Uber Technologies, Inc.", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "CRM", "name": "Salesforce, Inc.", "exchange": "NYSE", "asset_class": "us_equity"},
    {"symbol": "BTC/USD", "name": "Bitcoin / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
    {"symbol": "ETH/USD", "name": "Ethereum / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
    {"symbol": "SOL/USD", "name": "Solana / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
    {"symbol": "DOGE/USD", "name": "Dogecoin / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
    {"symbol": "AVAX/USD", "name": "Avalanche / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
    {"symbol": "LINK/USD", "name": "Chainlink / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
    {"symbol": "UNI/USD", "name": "Uniswap / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
    {"symbol": "ADA/USD", "name": "Cardano / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
    {"symbol": "XRP/USD", "name": "XRP / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
    {"symbol": "NEAR/USD", "name": "NEAR Protocol / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
    {"symbol": "DOT/USD", "name": "Polkadot / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
    {"symbol": "SUI/USD", "name": "Sui / US Dollar", "exchange": "CRYPTO", "asset_class": "crypto"},
]

def fetch_snapshots_for_symbols(symbols: list[str]) -> dict[str, dict]:
    """
    Fetch live stock and crypto snapshots on-demand directly from Alpaca API for any batch of symbols.
    Updates and caches the returned live prices and 24h change percentages into _SNAPSHOT_CACHE.
    Returns { symbol: { "price": float, "change": str, "updated_at": float } }.
    """
    if not symbols:
        return {}

    clean_syms = []
    seen = set()
    for s in symbols:
        c = s.strip().upper()
        if c and c not in seen:
            seen.add(c)
            clean_syms.append(c)

    stock_syms = []
    crypto_syms = []
    for s in clean_syms:
        if "/" in s or (s.endswith("USD") and len(s) > 4):
            crypto_syms.append(s)
        else:
            stock_syms.append(s)

    snapshots: dict[str, dict] = {}
    now = time.time()

    def _fetch_stocks():
        if not stock_syms:
            return
        try:
            req = StockSnapshotRequest(symbol_or_symbols=stock_syms, feed=DataFeed.IEX)
            res = stock_data_client.get_stock_snapshot(req)
            for sym, snap in res.items():
                if snap:
                    price = 0.0
                    if snap.latest_trade and snap.latest_trade.price:
                        price = float(snap.latest_trade.price)
                    elif snap.minute_bar and snap.minute_bar.close:
                        price = float(snap.minute_bar.close)
                    elif snap.daily_bar and snap.daily_bar.close:
                        price = float(snap.daily_bar.close)

                    if price > 0:
                        prev = float(snap.previous_daily_bar.close) if (snap.previous_daily_bar and snap.previous_daily_bar.close) else price
                        pct = round(((price - prev) / prev) * 100, 2) if prev and prev > 0 else 0.0
                        entry = {
                            "price": round(price, 2),
                            "change": f"+{pct:.2f}%" if pct >= 0 else f"{pct:.2f}%",
                            "updated_at": now,
                        }
                        snapshots[sym] = entry
                        _SNAPSHOT_CACHE[sym] = entry
        except Exception as e:
            logger.warning(f"Live stock snapshots error for {stock_syms[:5]}...: {e}")

    def _fetch_crypto():
        if not crypto_syms:
            return
        try:
            formatted_crypto = [s if "/" in s else f"{s[:-3]}/{s[-3:]}" for s in crypto_syms]
            req = CryptoSnapshotRequest(symbol_or_symbols=formatted_crypto)
            res: Any = crypto_data_client.get_crypto_snapshot(req)
            items = res.items() if isinstance(res, dict) else []
            for sym, snap in items:
                if snap:
                    price = 0.0
                    has_quote = bool(
                        snap.latest_quote and
                        getattr(snap.latest_quote, "bid_price", None) and
                        getattr(snap.latest_quote, "ask_price", None) and
                        float(snap.latest_quote.bid_price) > 0 and
                        float(snap.latest_quote.ask_price) > 0
                    )
                    has_trade = bool(
                        snap.latest_trade and
                        getattr(snap.latest_trade, "price", None) and
                        float(snap.latest_trade.price) > 0
                    )

                    if has_quote and has_trade:
                        q_time = getattr(snap.latest_quote, "timestamp", None)
                        t_time = getattr(snap.latest_trade, "timestamp", None)
                        trade_age = (now - t_time.timestamp()) if (t_time and hasattr(t_time, "timestamp")) else 9999
                        if (q_time and t_time and q_time >= t_time) or trade_age > 20:
                            price = (float(snap.latest_quote.bid_price) + float(snap.latest_quote.ask_price)) / 2.0
                        else:
                            price = float(snap.latest_trade.price)
                    elif has_quote:
                        price = (float(snap.latest_quote.bid_price) + float(snap.latest_quote.ask_price)) / 2.0
                    elif has_trade:
                        price = float(snap.latest_trade.price)
                    elif snap.minute_bar and snap.minute_bar.close:
                        price = float(snap.minute_bar.close)
                    elif snap.daily_bar and snap.daily_bar.close:
                        price = float(snap.daily_bar.close)

                    if price > 0:
                        prev = float(snap.previous_daily_bar.close) if (snap.previous_daily_bar and snap.previous_daily_bar.close) else price
                        pct = round(((price - prev) / prev) * 100, 2) if prev and prev > 0 else 0.0
                        price_rounded = round(price, 4) if price < 1.0 else (round(price, 3) if price < 10.0 else round(price, 2))
                        entry = {
                            "price": price_rounded,
                            "change": f"+{pct:.2f}%" if pct >= 0 else f"{pct:.2f}%",
                            "updated_at": now,
                        }
                        snapshots[sym] = entry
                        snapshots[sym.replace("/", "")] = entry
                        _SNAPSHOT_CACHE[sym] = entry
                        _SNAPSHOT_CACHE[sym.replace("/", "")] = entry
        except Exception as e:
            logger.warning(f"Live crypto snapshots error for {crypto_syms[:5]}...: {e}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(_fetch_stocks)
        f2 = executor.submit(_fetch_crypto)
        f1.result()
        f2.result()

    return snapshots

def _fetch_live_alpaca_snapshots() -> dict[str, dict]:
    """Fetch live stock and crypto snapshots in parallel directly from Alpaca API."""
    all_syms = [item["symbol"] for item in POPULAR_MARKET_SYMBOLS]
    return fetch_snapshots_for_symbols(all_syms)

def get_asset_name(symbol: str) -> str:
    """Resolve full human-readable asset/company name for a ticker from cache or popular list."""
    clean = symbol.strip().upper()
    # Check POPULAR_MARKET_SYMBOLS
    for item in POPULAR_MARKET_SYMBOLS:
        if item["symbol"].upper() == clean or item["symbol"].replace("/", "").upper() == clean:
            return item["name"]
    # Check loaded Alpaca assets cache
    if _ALL_ALPACA_ASSETS_CACHE:
        for item in _ALL_ALPACA_ASSETS_CACHE:
            if item["symbol"].upper() == clean or item["symbol"].replace("/", "").upper() == clean:
                return item["name"]
    return clean

_ALL_ALPACA_ASSETS_CACHE: list[dict[str, Any]] = []
_ALL_ALPACA_ASSETS_CACHE_TIME: float = 0.0
_ALL_ALPACA_ASSETS_LOCK = threading.Lock()

def fetch_all_alpaca_assets() -> list[dict[str, Any]]:
    """
    Fetch all active tradeable assets directly from Alpaca Trading API.
    Covers all US equities (NYSE, NASDAQ, AMEX, ARCA, BATS) and Crypto.
    """
    try:
        req = GetAssetsRequest(status=AssetStatus.ACTIVE)
        raw_assets = trading_client.get_all_assets(req)

        assets_list = []
        popular_index = {item["symbol"]: idx for idx, item in enumerate(POPULAR_MARKET_SYMBOLS)}

        for a in raw_assets:
            if not getattr(a, "tradable", False):
                continue
            sym = str(getattr(a, "symbol", "")).strip().upper()
            if not sym:
                continue

            name = str(getattr(a, "name", "") or sym)
            raw_ex = getattr(a, "exchange", "US")
            if hasattr(raw_ex, "value"):
                exchange = str(raw_ex.value).upper()
            else:
                exchange = str(raw_ex).split(".")[-1].upper()
            if exchange.startswith("ASSETEXCHANGE."):
                exchange = exchange.replace("ASSETEXCHANGE.", "")

            raw_ac = getattr(a, "asset_class", "us_equity")
            if hasattr(raw_ac, "value"):
                asset_class = str(raw_ac.value).lower()
            else:
                asset_class = str(raw_ac).split(".")[-1].lower()
            if asset_class.startswith("assetclass."):
                asset_class = asset_class.replace("assetclass.", "")
            if "crypto" in asset_class:
                asset_class = "crypto"
            else:
                asset_class = "us_equity"

            cached = _SNAPSHOT_CACHE.get(sym)
            price = cached["price"] if cached else 0.0
            change = cached["change"] if cached else "0.00%"

            assets_list.append({
                "symbol": sym,
                "name": name,
                "exchange": exchange,
                "asset_class": asset_class,
                "tradable": True,
                "price": price,
                "change": change,
            })

        # Prepend popular/active markets first, followed alphabetically
        assets_list.sort(key=lambda x: (popular_index.get(x["symbol"], 999999), x["symbol"]))

        logger.info(f"Loaded {len(assets_list)} active tradeable markets from Alpaca Trading API")
        return assets_list
    except Exception as e:
        logger.error(f"Failed to fetch all assets from Alpaca Trading API: {e}")
        return []

def _warm_snapshot_cache():
    global _SNAPSHOT_CACHE, _SNAPSHOT_CACHE_TIME, _ALL_ALPACA_ASSETS_CACHE, _ALL_ALPACA_ASSETS_CACHE_TIME
    try:
        data = _fetch_live_alpaca_snapshots()
        if data:
            _SNAPSHOT_CACHE = data
            _SNAPSHOT_CACHE_TIME = time.time()
    except Exception:
        pass

    try:
        assets = fetch_all_alpaca_assets()
        if assets:
            with _ALL_ALPACA_ASSETS_LOCK:
                _ALL_ALPACA_ASSETS_CACHE = assets
                _ALL_ALPACA_ASSETS_CACHE_TIME = time.time()
    except Exception:
        pass

# Background warm-up thread for immediate availability of live Alpaca market data
threading.Thread(target=_warm_snapshot_cache, daemon=True).start()

def reinitialize_alpaca_clients(
    api_key: str,
    secret_key: str,
    base_url: str | None = None,
    paper: bool = True,
) -> Any:
    """
    Dynamically re-instantiate all Alpaca SDK clients with new credentials in memory.
    Flushes all market snapshot, asset, and positions caches.
    Returns the newly connected Alpaca Account object.
    """
    global trading_client, stock_data_client, option_data_client, crypto_data_client, stock_stream
    global _SNAPSHOT_CACHE, _SNAPSHOT_CACHE_TIME, _ALL_ALPACA_ASSETS_CACHE, _ALL_ALPACA_ASSETS_CACHE_TIME

    clean_key = api_key.strip()
    clean_secret = secret_key.strip()

    # Instantiate fresh clients
    new_trading_client = TradingClient(
        api_key=clean_key,
        secret_key=clean_secret,
        paper=paper,
    )

    # Validate immediately by fetching account
    account = new_trading_client.get_account()

    new_stock_data = StockHistoricalDataClient(
        clean_key,
        clean_secret,
    )
    new_option_data = OptionHistoricalDataClient(
        clean_key,
        clean_secret,
    )
    new_crypto_data = CryptoHistoricalDataClient(
        clean_key,
        clean_secret,
    )
    new_stock_stream = StockDataStream(
        clean_key,
        clean_secret,
        feed=DataFeed.IEX,
    )

    # Assign globals
    trading_client = new_trading_client
    stock_data_client = new_stock_data
    option_data_client = new_option_data
    crypto_data_client = new_crypto_data
    stock_stream = new_stock_stream

    # Flush all caches
    with _ALL_ALPACA_ASSETS_LOCK:
        _SNAPSHOT_CACHE = {}
        _SNAPSHOT_CACHE_TIME = 0.0
        _ALL_ALPACA_ASSETS_CACHE = []
        _ALL_ALPACA_ASSETS_CACHE_TIME = 0.0

    # Trigger background snapshot warm-up for new account
    threading.Thread(target=_warm_snapshot_cache, daemon=True).start()

    acc_id = getattr(account, "id", None) or (account.get("id") if isinstance(account, dict) else str(account))
    logger.info(f"Alpaca clients reinitialized successfully for account {acc_id}")
    return account

def get_account() -> Any:
    """Fetch the Alpaca paper trading account."""
    return trading_client.get_account()

def get_positions():
    """Fetch all current positions from the Alpaca paper account."""
    return trading_client.get_all_positions()

def get_assets():
    """Fetch all active assets with actual live market data from Alpaca API."""
    global _ALL_ALPACA_ASSETS_CACHE, _ALL_ALPACA_ASSETS_CACHE_TIME, _SNAPSHOT_CACHE, _SNAPSHOT_CACHE_TIME
    now = time.time()

    # Refresh snapshots cache if empty or older than 30 seconds
    if not _SNAPSHOT_CACHE or (now - _SNAPSHOT_CACHE_TIME) > 30:
        new_data = _fetch_live_alpaca_snapshots()
        if new_data:
            _SNAPSHOT_CACHE = new_data
            _SNAPSHOT_CACHE_TIME = now

    # Check if full Alpaca assets cache is valid (within 1 hour)
    if _ALL_ALPACA_ASSETS_CACHE and (now - _ALL_ALPACA_ASSETS_CACHE_TIME) < 3600:
        # Update live prices for assets present in snapshot cache
        if _SNAPSHOT_CACHE:
            for item in _ALL_ALPACA_ASSETS_CACHE:
                cached = _SNAPSHOT_CACHE.get(item["symbol"])
                if cached:
                    item["price"] = cached["price"]
                    item["change"] = cached["change"]
        return _ALL_ALPACA_ASSETS_CACHE

    with _ALL_ALPACA_ASSETS_LOCK:
        if _ALL_ALPACA_ASSETS_CACHE and (now - _ALL_ALPACA_ASSETS_CACHE_TIME) < 3600:
            return _ALL_ALPACA_ASSETS_CACHE

        fetched = fetch_all_alpaca_assets()
        if fetched:
            _ALL_ALPACA_ASSETS_CACHE = fetched
            _ALL_ALPACA_ASSETS_CACHE_TIME = now
            return _ALL_ALPACA_ASSETS_CACHE

        # Fallback to POPULAR_MARKET_SYMBOLS if Alpaca asset request failed
        result = []
        for item in POPULAR_MARKET_SYMBOLS:
            cached = _SNAPSHOT_CACHE.get(item["symbol"])
            price = cached["price"] if cached else 0.0
            change = cached["change"] if cached else "0.00%"

            result.append({
                "symbol": item["symbol"],
                "name": item["name"],
                "exchange": item["exchange"],
                "asset_class": item["asset_class"],
                "tradable": True,
                "price": price,
                "change": change,
            })
        return result

def get_latest_price(symbol: str, max_cache_age: float = 1.5) -> float:
    """
    Fetch the latest available real-time trade/quote price for any stock, crypto, or option from Alpaca.
    Ensures true real-time sub-second price discovery rather than returning stale snapshots.
    """
    sym = symbol.strip().upper()
    now = time.time()

    # 1. Check snapshot cache ONLY if fresh (within max_cache_age, default 1.5s)
    cached = _SNAPSHOT_CACHE.get(sym)
    if cached and cached.get("price") and cached["price"] > 0:
        updated_at = cached.get("updated_at", 0)
        if (now - updated_at) <= max_cache_age:
            return float(cached["price"])

    alt_cache_sym = f"{sym[:-3]}/USD" if (sym.endswith("USD") and "/" not in sym and len(sym) > 3) else sym.replace("/", "")
    cached_alt = _SNAPSHOT_CACHE.get(alt_cache_sym)
    if cached_alt and cached_alt.get("price") and cached_alt["price"] > 0:
        updated_at = cached_alt.get("updated_at", 0)
        if (now - updated_at) <= max_cache_age:
            return float(cached_alt["price"])

    # 2. If crypto symbol (e.g. BTC/USD, BTCUSD, SOL/USD, SOLUSD) - query live 24/7 crypto quote stream first
    is_crypto = "/" in sym or sym.endswith("USD") or sym.endswith("USDT") or sym in {
        "BTC", "ETH", "SOL", "DOGE", "AVAX", "LINK", "UNI", "AAVE", "LTC", "BCH", "SHIB", "DOT", "MATIC"
    }
    if is_crypto:
        if "/" in sym:
            crypto_sym = sym
        elif sym.endswith("USD") and len(sym) > 3:
            crypto_sym = f"{sym[:-3]}/USD"
        elif sym.endswith("USDT") and len(sym) > 4:
            crypto_sym = f"{sym[:-4]}/USD"
        else:
            crypto_sym = f"{sym}/USD"

        # 2a. Try live crypto quote (bid/ask mid-price) for instant sub-second precision
        try:
            q_req = CryptoLatestQuoteRequest(symbol_or_symbols=crypto_sym)
            q_res: Any = crypto_data_client.get_crypto_latest_quote(q_req)
            q_obj = q_res.get(crypto_sym) if isinstance(q_res, dict) else getattr(q_res, crypto_sym, None)
            if q_obj and getattr(q_obj, "bid_price", None) and getattr(q_obj, "ask_price", None):
                b = float(q_obj.bid_price)
                a = float(q_obj.ask_price)
                if b > 0 and a > 0:
                    p = round((b + a) / 2.0, 4 if b < 1.0 else (3 if b < 10.0 else 2))
                    _SNAPSHOT_CACHE[sym] = {"price": p, "updated_at": now}
                    _SNAPSHOT_CACHE[crypto_sym] = {"price": p, "updated_at": now}
                    return p
        except Exception:
            pass

        # 2b. Try crypto latest trade directly from Alpaca Crypto API
        try:
            req = CryptoLatestTradeRequest(symbol_or_symbols=crypto_sym)
            res: Any = crypto_data_client.get_crypto_latest_trade(req)
            trade_obj = None
            if isinstance(res, dict) and crypto_sym in res:
                trade_obj = res[crypto_sym]
            elif hasattr(res, "data") and isinstance(res.data, dict) and crypto_sym in res.data:
                trade_obj = res.data[crypto_sym]
            elif hasattr(res, crypto_sym):
                trade_obj = getattr(res, crypto_sym)
            if trade_obj and getattr(trade_obj, "price", None):
                p = float(trade_obj.price)
                _SNAPSHOT_CACHE[sym] = {"price": p, "updated_at": now}
                _SNAPSHOT_CACHE[crypto_sym] = {"price": p, "updated_at": now}
                return p
        except Exception:
            pass

        # 2c. Try crypto snapshot
        try:
            snap_req = CryptoSnapshotRequest(symbol_or_symbols=crypto_sym)
            snap_res: Any = crypto_data_client.get_crypto_snapshot(snap_req)
            if snap_res and crypto_sym in snap_res:
                s = snap_res[crypto_sym]
                if getattr(s, "latest_quote", None) and getattr(s.latest_quote, "bid_price", None) and getattr(s.latest_quote, "ask_price", None):
                    b = float(s.latest_quote.bid_price)
                    a = float(s.latest_quote.ask_price)
                    if b > 0 and a > 0:
                        p = round((b + a) / 2.0, 4 if b < 1.0 else 2)
                        _SNAPSHOT_CACHE[sym] = {"price": p, "updated_at": now}
                        _SNAPSHOT_CACHE[crypto_sym] = {"price": p, "updated_at": now}
                        return p
                if getattr(s, "latest_trade", None) and getattr(s.latest_trade, "price", None):
                    p = float(s.latest_trade.price)
                    _SNAPSHOT_CACHE[sym] = {"price": p, "updated_at": now}
                    _SNAPSHOT_CACHE[crypto_sym] = {"price": p, "updated_at": now}
                    return p
                if getattr(s, "daily_bar", None) and getattr(s.daily_bar, "close", None):
                    p = float(s.daily_bar.close)
                    _SNAPSHOT_CACHE[sym] = {"price": p, "updated_at": now}
                    return p
        except Exception:
            pass

    # 3. If option contract (OCC symbol format, e.g. AAPL260320C00250000)
    is_opt = len(sym) > 6 and any(c.isdigit() for c in sym)
    if is_opt:
        # 3a. Try option quote first (bid/ask mid-price)
        try:
            q_req = OptionLatestQuoteRequest(symbol_or_symbols=sym)
            q_res = option_data_client.get_option_latest_quote(q_req)
            if q_res and sym in q_res:
                q_obj = q_res[sym]
                bid = float(getattr(q_obj, "bid_price", 0) or 0)
                ask = float(getattr(q_obj, "ask_price", 0) or 0)
                if bid > 0 or ask > 0:
                    mid = (bid + ask) / 2.0 if (bid > 0 and ask > 0) else (ask or bid)
                    p = round(mid, 2)
                    _SNAPSHOT_CACHE[sym] = {"price": p, "updated_at": now}
                    return p
        except Exception:
            pass

        # 3b. Try option latest trade
        try:
            req = OptionLatestTradeRequest(symbol_or_symbols=sym)
            res = option_data_client.get_option_latest_trade(req)
            if res and sym in res and getattr(res[sym], "price", None):
                p = float(res[sym].price)
                _SNAPSHOT_CACHE[sym] = {"price": p, "updated_at": now}
                return p
        except Exception:
            pass

    # 4. Stock / ETF latest trade or quote from Alpaca Market Data
    try:
        request = StockLatestTradeRequest(
            symbol_or_symbols=sym,
            feed=DataFeed.IEX,
        )
        latest_trade = stock_data_client.get_stock_latest_trade(request)
        if sym in latest_trade and latest_trade[sym].price:
            p = float(latest_trade[sym].price)
            _SNAPSHOT_CACHE[sym] = {"price": p, "updated_at": now}
            return p
    except Exception as e:
        logger.warning(f"StockLatestTradeRequest failed for {sym}: {e}")

    # 4b. Stock / ETF quote fallback (extended hours / pre-market)
    try:
        q_request = StockLatestQuoteRequest(
            symbol_or_symbols=sym,
            feed=DataFeed.IEX,
        )
        latest_quote = stock_data_client.get_stock_latest_quote(q_request)
        if sym in latest_quote and latest_quote[sym]:
            q_item = latest_quote[sym]
            bid = float(getattr(q_item, "bid_price", 0) or 0)
            ask = float(getattr(q_item, "ask_price", 0) or 0)
            if bid > 0 and ask > 0:
                p = round((bid + ask) / 2.0, 2)
                _SNAPSHOT_CACHE[sym] = {"price": p, "updated_at": now}
                return p
    except Exception:
        pass

    # 5. On-demand live snapshot fetch to populate cache
    try:
        fresh_snaps = fetch_snapshots_for_symbols([sym])
        if sym in fresh_snaps and fresh_snaps[sym].get("price") and fresh_snaps[sym]["price"] > 0:
            return float(fresh_snaps[sym]["price"])
        if alt_cache_sym in fresh_snaps and fresh_snaps[alt_cache_sym].get("price") and fresh_snaps[alt_cache_sym]["price"] > 0:
            return float(fresh_snaps[alt_cache_sym]["price"])
    except Exception:
        pass

    # 6. Fallback to cached snapshot (even if older than max_cache_age)
    if cached and cached.get("price") and cached["price"] > 0:
        return float(cached["price"])
    if cached_alt and cached_alt.get("price") and cached_alt["price"] > 0:
        return float(cached_alt["price"])

    # 7. Fallback to latest bar close
    try:
        bars = get_market_bars(sym, timeframe="1D")
        if bars and len(bars) > 0:
            return bars[-1]["close"]
    except Exception:
        pass

    raise ValueError(f"No real-time market price available for {sym}")

def get_market_bars(
    symbol: str,
    timeframe: str = "1M",
):
    symbol = symbol.upper().strip()
    timeframe = timeframe.upper().strip()
    cache_key = f"{symbol}_{timeframe}"

    # Cache TTL: daily/multi-month bars change slowly (5 min), intraday bars refresh faster (1-2 min)
    if timeframe == "1D":
        cache_ttl = 60.0
    elif timeframe == "5D":
        cache_ttl = 120.0
    else:  # 1M, 3M, 1Y
        cache_ttl = 300.0

    now = time.time()
    with _BARS_CACHE_LOCK:
        if cache_key in _BARS_CACHE:
            cached_time, cached_bars = _BARS_CACHE[cache_key]
            if now - cached_time < cache_ttl and len(cached_bars) > 0:
                return cached_bars

    end = datetime.now(timezone.utc)

    timeframe_map: dict[str, TimeframeConfig] = {
        "1D": {
            "alpaca_timeframe": TimeFrame(
                5,
                TimeFrameUnit.Minute,
            ),
            "days": 3,
        },

        "5D": {
            "alpaca_timeframe": TimeFrame(
                15,
                TimeFrameUnit.Minute,
            ),
            "days": 10,
        },

        "1M": {
            "alpaca_timeframe": TimeFrame.Day,
            "days": 45,
        },

        "3M": {
            "alpaca_timeframe": TimeFrame.Day,
            "days": 120,
        },

        "1Y": {
            "alpaca_timeframe": TimeFrame.Day,
            "days": 400,
        },
    }

    config = timeframe_map.get(
        timeframe,
    )

    if config is None:
        raise ValueError(
            f"Unsupported timeframe: {timeframe}"
        )

    start = end - timedelta(
        days=config["days"],
    )

    req: CryptoBarsRequest | None = None
    request: StockBarsRequest | None = None
    crypto_sym: str = ""

    is_crypto = "/" in symbol or symbol.endswith("USD") or symbol in {
        "BTC", "ETH", "SOL", "DOGE", "AVAX", "LINK", "UNI", "AAVE", "LTC", "BCH", "SHIB", "DOT", "MATIC"
    }

    if is_crypto:
        if "/" in symbol:
            crypto_sym = symbol
        elif symbol.endswith("USD") and len(symbol) > 3:
            crypto_sym = f"{symbol[:-3]}/USD"
        else:
            crypto_sym = f"{symbol}/USD"
        req = CryptoBarsRequest(
            symbol_or_symbols=crypto_sym,
            timeframe=config["alpaca_timeframe"],
            start=start,
            end=end,
        )
    else:
        request = StockBarsRequest(
            symbol_or_symbols=symbol,
            timeframe=config["alpaca_timeframe"],
            start=start,
            end=end,
            feed=DataFeed.IEX,
        )

    raw_bars = []
    max_retries = 3
    global _BARS_LAST_REQ_TIME

    for attempt in range(max_retries):
        # Rate-limiting pacing: enforce minimum 65ms gap between outbound bars requests (~15 req/s max)
        with _BARS_REQ_LOCK:
            elapsed = time.time() - _BARS_LAST_REQ_TIME
            if elapsed < 0.065:
                time.sleep(0.065 - elapsed)
            _BARS_LAST_REQ_TIME = time.time()

        try:
            if is_crypto and req is not None:
                bars_resp = crypto_data_client.get_crypto_bars(req)
                data_dict = getattr(bars_resp, "data", bars_resp)
                if isinstance(data_dict, dict) and crypto_sym in data_dict:
                    raw_bars = list(data_dict[crypto_sym])
                else:
                    raw_bars = []
                break
            elif request is not None:
                bars = stock_data_client.get_stock_bars(request)
                data_dict = getattr(bars, "data", bars)
                if isinstance(data_dict, dict) and symbol in data_dict:
                    raw_bars = list(data_dict[symbol])
                else:
                    raw_bars = []
                break
            else:
                break
        except Exception as err:
            err_msg = str(err).lower()
            if "too many requests" in err_msg or "429" in err_msg:
                if attempt < max_retries - 1:
                    backoff = (attempt + 1) * 0.75 + random.uniform(0.1, 0.4)
                    logger.warning(f"Alpaca rate limit for {symbol} ({timeframe}), backing off {backoff:.2f}s (attempt {attempt+1}/{max_retries})")
                    time.sleep(backoff)
                    continue
                else:
                    logger.warning(f"Alpaca rate limit persisted for {symbol} after {max_retries} attempts: {err}")
                    # Gracefully return stale cached data if available
                    with _BARS_CACHE_LOCK:
                        if cache_key in _BARS_CACHE:
                            _, stale_bars = _BARS_CACHE[cache_key]
                            if stale_bars:
                                return stale_bars
                    raw_bars = []
                    break
            else:
                logger.warning(f"Bars request failed for {symbol}: {err}")
                raw_bars = []
                break

    if not raw_bars:
        # Fallback to stale cache if any error occurred
        with _BARS_CACHE_LOCK:
            if cache_key in _BARS_CACHE:
                _, stale_bars = _BARS_CACHE[cache_key]
                if stale_bars:
                    return stale_bars

    # -----------------------------------------------------
    # 1D
    # Keep only the latest available trading session.
    # -----------------------------------------------------

    if timeframe == "1D":

        if raw_bars:
            latest_session = (
                raw_bars[-1]
                .timestamp
                .astimezone(timezone.utc)
                .date()
            )

            raw_bars = [
                bar
                for bar in raw_bars
                if (
                    bar.timestamp
                    .astimezone(timezone.utc)
                    .date()
                    == latest_session
                )
            ]

    # -----------------------------------------------------
    # 5D
    # Keep exactly the latest five trading sessions.
    # -----------------------------------------------------

    elif timeframe == "5D":

        trading_dates = []

        for bar in reversed(raw_bars):

            trading_date = (
                bar.timestamp
                .astimezone(timezone.utc)
                .date()
            )

            if trading_date not in trading_dates:
                trading_dates.append(
                    trading_date
                )

            if len(trading_dates) == 5:
                break

        trading_dates = set(
            trading_dates
        )

        raw_bars = [
            bar
            for bar in raw_bars
            if (
                bar.timestamp
                .astimezone(timezone.utc)
                .date()
                in trading_dates
            )
        ]

    # -----------------------------------------------------
    # 1M
    # -----------------------------------------------------

    elif timeframe == "1M":

        cutoff = subtract_months(
            end,
            1,
        )

        raw_bars = [
            bar
            for bar in raw_bars
            if bar.timestamp >= cutoff
        ]

    # -----------------------------------------------------
    # 3M
    # -----------------------------------------------------

    elif timeframe == "3M":

        cutoff = subtract_months(
            end,
            3,
        )

        raw_bars = [
            bar
            for bar in raw_bars
            if bar.timestamp >= cutoff
        ]

    # -----------------------------------------------------
    # 1Y
    # -----------------------------------------------------

    elif timeframe == "1Y":

        cutoff = subtract_months(
            end,
            12,
        )

        raw_bars = [
            bar
            for bar in raw_bars
            if bar.timestamp >= cutoff
        ]

    formatted_bars = [
        {
            "timestamp": bar.timestamp.isoformat(),
            "open": float(bar.open),
            "high": float(bar.high),
            "low": float(bar.low),
            "close": float(bar.close),
            "volume": float(bar.volume),
        }
        for bar in raw_bars
    ]

    if formatted_bars:
        with _BARS_CACHE_LOCK:
            _BARS_CACHE[cache_key] = (time.time(), formatted_bars)

    return formatted_bars

def subtract_months(
    value: datetime,
    months: int,
) -> datetime:
    month_index = (
        value.year * 12
        + value.month
        - 1
        - months
    )

    year = month_index // 12
    month = month_index % 12 + 1

    day = min(
        value.day,
        calendar.monthrange(
            year,
            month,
        )[1],
    )

    return value.replace(
        year=year,
        month=month,
        day=day,
    )
def get_option_contracts(
    symbol: str,
    option_type: str,
    min_days_to_expiration: int = 14,
    max_days_to_expiration: int = 45,
    strike_price_gte: float | None = None,
    strike_price_lte: float | None = None,
):
    """
    Retrieve active option contracts for an
    underlying symbol.
    """

    symbol = symbol.upper()

    today = datetime.now(
        timezone.utc,
    ).date()

    expiration_date_gte = (
        today
        + timedelta(
            days=min_days_to_expiration,
        )
    )

    expiration_date_lte = (
        today
        + timedelta(
            days=max_days_to_expiration,
        )
    )

    if option_type.lower() == "call":

        contract_type = ContractType.CALL

    elif option_type.lower() == "put":

        contract_type = ContractType.PUT

    else:

        raise ValueError(
            "option_type must be "
            "'call' or 'put'"
        )

    request = GetOptionContractsRequest(
        underlying_symbols=[
            symbol,
        ],
        expiration_date_gte=(
            expiration_date_gte
        ),
        expiration_date_lte=(
            expiration_date_lte
        ),
        strike_price_gte=(
            str(strike_price_gte)
            if strike_price_gte is not None
            else None
        ),
        strike_price_lte=(
            str(strike_price_lte)
            if strike_price_lte is not None
            else None
        ),
        type=contract_type,
        limit=100,
    )

    response = (
        trading_client.get_option_contracts(
            request,
        )
    )

    if isinstance(response, dict):
        return response.get("option_contracts", [])
    return response.option_contracts
def get_option_snapshot(
    option_symbol: str,
):
    """
    Retrieve the latest market snapshot for
    an option contract.
    """

    option_symbol = option_symbol.upper()

    request = OptionSnapshotRequest(
        symbol_or_symbols=option_symbol,
        feed=OptionsFeed.INDICATIVE,
    )

    snapshots = (
        option_data_client.get_option_snapshot(
            request,
        )
    )

    snapshot = snapshots.get(
        option_symbol,
    )

    if snapshot is None:
        raise ValueError(
            f"No option market data found for "
            f"{option_symbol}"
        )

    latest_quote = snapshot.latest_quote
    latest_trade = snapshot.latest_trade

    bid_price = (
        float(latest_quote.bid_price)
        if latest_quote is not None
        else None
    )

    ask_price = (
        float(latest_quote.ask_price)
        if latest_quote is not None
        else None
    )

    latest_trade_price = (
        float(latest_trade.price)
        if latest_trade is not None
        else None
    )

    if (
        bid_price is not None
        and ask_price is not None
        and bid_price > 0
        and ask_price > 0
    ):
        estimated_premium = (
            bid_price + ask_price
        ) / 2

    elif latest_trade_price is not None:
        estimated_premium = (
            latest_trade_price
        )

    else:
        raise ValueError(
            f"No usable option price found for "
            f"{option_symbol}"
        )

    return {
        "symbol": option_symbol,
        "bid_price": bid_price,
        "ask_price": ask_price,
        "latest_trade_price": (
            latest_trade_price
        ),
        "estimated_premium": round(
            estimated_premium,
            4,
        ),
        "implied_volatility": (
            float(snapshot.implied_volatility)
            if snapshot.implied_volatility
            is not None
            else None
        ),
    }

def get_option_chain(
    symbol: str,
):
    """
    Retrieve option-chain snapshots with
    currently available option market data.
    """

    request = OptionChainRequest(
        underlying_symbol=symbol.upper(),
        feed=OptionsFeed.INDICATIVE,
    )

    return option_data_client.get_option_chain(
        request
    )


def submit_option_order(
    symbol: str,
    qty: int | float,
    side: str = "buy",
    order_type: str = "market",
    limit_price: float | None = None,
    extended_hours: bool = True,
):
    """
    Submit an options, equity, or crypto order to Alpaca Paper Trading.
    Can be used by autonomous agents and trade execution endpoints.
    - For Crypto: Enforces TimeInForce.GTC, extended_hours=False, and float quantity.
    - For Equities outside regular hours: Automatically upgrades to aggressive limit order
      with extended_hours=True to fill immediately on Alpaca Paper Trading.
    """
    clean_sym = symbol.strip().upper()
    is_crypto = "/" in clean_sym or clean_sym.endswith("USD") or clean_sym in {"BTCUSD", "ETHUSD", "SOLUSD", "DOGEUSD", "AVAXUSD"}
    is_option = len(clean_sym) > 6 and any(c.isdigit() for c in clean_sym)
    order_side = OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL

    if is_crypto:
        # Crypto trading rules on Alpaca: TimeInForce must be GTC, extended_hours must be False
        order_qty = float(qty)
        if order_type.lower() == "limit":
            if limit_price is None or limit_price <= 0:
                cur_price = get_latest_price(clean_sym)
                limit_price = cur_price
            order_request = LimitOrderRequest(
                symbol=clean_sym,
                qty=order_qty,
                side=order_side,
                time_in_force=TimeInForce.GTC,
                limit_price=round(limit_price, 4 if limit_price < 1.0 else 2),
                extended_hours=False,
            )
        else:
            order_request = MarketOrderRequest(
                symbol=clean_sym,
                qty=order_qty,
                side=order_side,
                time_in_force=TimeInForce.GTC,
            )
    else:
        # Equity or Option
        # Check market clock for extended-hours routing
        is_market_open = False
        try:
            clock = trading_client.get_clock()
            is_market_open = getattr(clock, "is_open", False)
        except Exception:
            pass

        if not is_market_open and not is_option:
            # If regular market is closed, market orders get stuck in NEW on Alpaca paper trading.
            # Auto-route as aggressive limit order with extended_hours=True crossing 1% spread so it fills immediately.
            cur_price = get_latest_price(clean_sym)
            if order_type.lower() == "market":
                limit_price = round(cur_price * 1.01 if side.lower() == "buy" else cur_price * 0.99, 2)
                order_type = "limit"
            elif limit_price is None or limit_price <= 0:
                limit_price = round(cur_price, 2)
            extended_hours = True

        parsed_qty = int(qty) if float(qty).is_integer() else qty

        if order_type.lower() == "limit":
            if limit_price is None or limit_price <= 0:
                cur_price = get_latest_price(clean_sym)
                limit_price = round(cur_price, 2)
            order_request = LimitOrderRequest(
                symbol=clean_sym,
                qty=parsed_qty,
                side=order_side,
                time_in_force=TimeInForce.DAY,
                limit_price=round(limit_price, 2),
                extended_hours=extended_hours if not is_option else False,
            )
        else:
            order_request = MarketOrderRequest(
                symbol=clean_sym,
                qty=parsed_qty,
                side=order_side,
                time_in_force=TimeInForce.DAY,
            )

    order = trading_client.submit_order(order_data=order_request)
    return order


def _wait_for_order_fill(order: Any, max_wait: float = 2.5) -> Any:
    """Wait briefly for Alpaca to match and fill a closing order so the UI reflects immediate completion."""
    ord_id = str(order.get("id") if isinstance(order, dict) else getattr(order, "id", "") or "")
    if not ord_id:
        return order
    start_t = time.time()
    while time.time() - start_t < max_wait:
        time.sleep(0.2)
        try:
            latest = trading_client.get_order_by_id(ord_id)
            raw_stat = latest.get("status") if isinstance(latest, dict) else getattr(latest, "status", None)
            ostat = str(getattr(raw_stat, "value", raw_stat) or "").lower().split(".")[-1]
            if ostat in ("filled", "canceled", "rejected", "expired"):
                return latest
        except Exception:
            break
    return order


def close_option_position(
    symbol_or_asset_id: str,
    qty: float | None = None,
):
    """
    Close an open equity or option position on Alpaca paper account.
    1. Cancels any active/open orders for this symbol first to avoid order collisions.
    2. If regular market is open (or contract is an option), calls standard close_position.
    3. If regular market is closed and asset is equity, submits an aggressive limit order
       with extended_hours=True to fill immediately on Alpaca paper trading.
    4. Waits briefly for fill confirmation so caller receives a completed/filled order.
    """
    clean_sym = symbol_or_asset_id.strip().upper()
    is_option = len(clean_sym) > 6 and any(c.isdigit() for c in clean_sym)

    # 1. Cancel any active/open orders for this symbol first
    try:
        open_orders = get_orders(status="open")
        for ord_item in open_orders:
            ord_sym = str(getattr(ord_item, "symbol", "")).upper()
            if ord_sym == clean_sym:
                ord_id = str(getattr(ord_item, "id", ""))
                if ord_id:
                    try:
                        trading_client.cancel_order_by_id(ord_id)
                    except Exception:
                        pass
        time.sleep(0.5)
    except Exception as e:
        logger.warning(f"Error canceling open orders before closing {clean_sym}: {e}")

    # 2. Check market clock
    clock_open = False
    try:
        clock = trading_client.get_clock()
        clock_open = bool(getattr(clock, "is_open", False))
    except Exception:
        clock_open = False

    # 3. If regular market is open, or if it is an option, use standard close_position
    if clock_open or is_option:
        close_options = ClosePositionRequest(qty=str(qty)) if qty is not None else None
        raw_order = trading_client.close_position(
            symbol_or_asset_id=clean_sym,
            close_options=close_options,
        )
        return _wait_for_order_fill(raw_order, max_wait=2.5)

    # 4. If regular market is closed and it is equity, use extended hours limit order
    try:
        pos = trading_client.get_open_position(clean_sym)
        pos_qty = float(getattr(pos, "qty", 0))
        pos_side = str(getattr(pos, "side", "long")).lower()
        actual_qty = qty if qty is not None else abs(pos_qty)

        if actual_qty > 0:
            order_side = OrderSide.SELL if (pos_side == "long" or pos_qty > 0) else OrderSide.BUY
            curr_p = get_latest_price(clean_sym)
            if curr_p <= 0:
                curr_p = float(getattr(pos, "current_price", getattr(pos, "avg_entry_price", 100.0)))

            # Cross spread by 1% to ensure immediate fill in paper trading
            limit_p = round(curr_p * 0.99, 2) if order_side == OrderSide.SELL else round(curr_p * 1.01, 2)

            req = LimitOrderRequest(
                symbol=clean_sym,
                qty=int(actual_qty) if actual_qty.is_integer() else actual_qty,
                side=order_side,
                time_in_force=TimeInForce.DAY,
                limit_price=limit_p,
                extended_hours=True,
            )
            order = trading_client.submit_order(req)
            return _wait_for_order_fill(order, max_wait=2.5)
    except Exception as ext_err:
        logger.warning(f"Extended hours limit close failed for {clean_sym}, falling back to standard close_position: {ext_err}")

    # Fallback to standard close_position
    close_options = ClosePositionRequest(qty=str(qty)) if qty is not None else None
    raw_order = trading_client.close_position(
        symbol_or_asset_id=clean_sym,
        close_options=close_options,
    )
    return _wait_for_order_fill(raw_order, max_wait=2.5)


def get_orders(status: str = "all", limit: int = 50):
    """
    Fetch recent orders from Alpaca paper account.
    """
    from alpaca.trading.requests import GetOrdersRequest
    from alpaca.trading.enums import QueryOrderStatus

    status_map = {
        "open": QueryOrderStatus.OPEN,
        "closed": QueryOrderStatus.CLOSED,
        "all": QueryOrderStatus.ALL,
    }
    request = GetOrdersRequest(
        status=status_map.get(status.lower(), QueryOrderStatus.ALL),
        limit=limit,
    )
    orders = trading_client.get_orders(request)
    if isinstance(orders, list):
        return orders
    return []


def cancel_order(order_id: str):
    """
    Cancel an active order by ID via Alpaca Trading API.
    """
    return trading_client.cancel_order_by_id(order_id)
