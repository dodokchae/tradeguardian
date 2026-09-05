'use client';

import React, { useState, useEffect } from 'react';
import { TradingViewChart } from '../../components/TradingViewChart';
import { ManagedPositionItem } from '../types/trade';

interface Props {
  position: ManagedPositionItem | null;
  isOpen: boolean;
  onClose: () => void;
  onClosePosition: (symbol: string) => Promise<void> | void;
  isClosing?: boolean;
}

const KNOWN_CRYPTO_LIST = new Set([
  'BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'UNI', 'ADA', 'DOT',
  'NEAR', 'MATIC', 'POL', 'XRP', 'LTC', 'BCH', 'ATOM', 'XLM', 'ALGO',
  'FIL', 'ICP', 'AAVE', 'SHIB', 'PEPE', 'SUI', 'APT', 'RENDER', 'FET',
  'TAO', 'INJ', 'TIA', 'OP', 'ARB', 'RNDR', 'STX', 'MKR', 'GRT', 'KSM'
]);

const isCryptoSymbol = (rawSymbol: string, pos?: ManagedPositionItem | null): boolean => {
  if (pos?.is_crypto) return true;
  if (pos?.asset_class === 'crypto') return true;
  const s = (rawSymbol || '').trim().toUpperCase();
  if (!s) return false;
  if (s.includes('/')) return true;
  if (KNOWN_CRYPTO_LIST.has(s)) return true;
  if (s.endsWith('USD') && KNOWN_CRYPTO_LIST.has(s.slice(0, -3))) return true;
  if (s.endsWith('USDT') && KNOWN_CRYPTO_LIST.has(s.slice(0, -4))) return true;
  return false;
};

const extractCryptoTicker = (rawSymbol: string): string => {
  const s = (rawSymbol || '').trim().toUpperCase();
  if (s.includes('/')) {
    const base = s.split('/')[0].replace(/[^A-Z0-9]/g, '');
    return `${base}USD`;
  }
  if (s.endsWith('USD')) {
    return s;
  }
  if (s.endsWith('USDT')) {
    return `${s.slice(0, -4)}USD`;
  }
  return `${s}USD`;
};

export const HoldingDetailModal: React.FC<Props> = ({
  position,
  isOpen,
  onClose,
  onClosePosition,
  isClosing = false,
}) => {
  const [chartInterval, setChartInterval] = useState<string>('5');
  const [chartStyle, setChartStyle] = useState<'1' | '8' | '3'>('1'); // 1=Candles, 8=Area, 3=Line
  const [showConfirmClose, setShowConfirmClose] = useState<boolean>(false);
  const [livePrice, setLivePrice] = useState<number | null>(null);

  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Reset confirmation state when position changes
  useEffect(() => {
    setShowConfirmClose(false);
    setLivePrice(null);
  }, [position?.symbol]);

  // Resolve the primary underlying symbol to chart (e.g., AAPL for equity or option)
  const resolveChartSymbol = (pos: ManagedPositionItem): string => {
    if (pos.underlying_symbol) return pos.underlying_symbol.toUpperCase();
    if (pos.is_option) {
      const match = pos.symbol.match(/^([A-Z]+)/);
      if (match) return match[1];
    }
    if (isCryptoSymbol(pos.symbol, pos)) {
      return extractCryptoTicker(pos.symbol);
    }
    const clean = pos.symbol.split('/')[0].replace(/[^A-Z]/gi, '').toUpperCase();
    return clean || pos.symbol;
  };

  // Format valid TradingView primary exchange ticker (e.g. NASDAQ:AAPL, NYSE:META, AMEX:SPY, COINBASE:SOLUSD)
  const formatTradingViewSymbol = (rawSymbol: string): string => {
    const s = rawSymbol.trim().toUpperCase();
    if (!s) return 'NASDAQ:AAPL';
    if (s.includes(':')) return s;
    if (isCryptoSymbol(s, position)) {
      const cryptoTicker = extractCryptoTicker(s);
      return `COINBASE:${cryptoTicker}`;
    }
    const nasdaqSet = new Set([
      'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'META', 'AMD', 'NFLX', 'AVGO', 'INTC', 'COIN', 'QQQ', 'ARM', 'ADBE', 'PYPL', 'CSCO', 'CMCSA', 'PEP', 'COST', 'TXN', 'QCOM', 'TMUS', 'AMAT', 'SBUX', 'INTU', 'ISRG', 'BKNG', 'VRTX', 'REGN', 'MDLZ', 'LRCX', 'ADI', 'PANW', 'SNPS', 'KLAC', 'CDNS', 'ASML', 'CRWD'
    ]);
    if (nasdaqSet.has(s)) return `NASDAQ:${s}`;
    if (['SPY', 'IWM', 'VXX', 'DIA', 'XLF', 'XLE'].includes(s)) return `AMEX:${s}`;
    return `NYSE:${s}`;
  };

  const chartSymbol = position ? resolveChartSymbol(position) : 'AAPL';
  const formattedTvSymbol = formatTradingViewSymbol(chartSymbol);
  const isCrypto = Boolean(position && isCryptoSymbol(position.symbol, position));

  // Poll live price from backend market/assets endpoint so numbers stay in sync with live quote
  useEffect(() => {
    if (!isOpen || !chartSymbol) return;
    let isMounted = true;
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

    const fetchLiveQuote = async () => {
      try {
        const res = await fetch(`${backendUrl}/assets/price/${encodeURIComponent(chartSymbol)}?_t=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.price && Number(data.price) > 0 && isMounted) {
            setLivePrice(Number(data.price));
          }
        }
      } catch {
        // Silently fallback to position data
      }
    };

    fetchLiveQuote();
    const timer = setInterval(fetchLiveQuote, 2000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [isOpen, chartSymbol]);

  if (!isOpen || !position) return null;

  const entryPrice = Number(position.avg_entry_price ?? 0);
  const qtyVal = Number(position.qty ?? 0);
  const multiplier = position.is_option ? 100.0 : 1.0;

  // Derive current price: prefer live market quote if available, else position.current_price
  const currPrice = livePrice && livePrice > 0
    ? livePrice
    : Number(position.current_price ?? entryPrice);

  const costBasis = Number(position.cost_basis ?? (qtyVal * entryPrice * multiplier));
  const marketVal = currPrice * qtyVal * multiplier;

  // Real-time P&L calculation: if equity, calculate against live market tick; if option, use position unrealized P&L
  const plVal = position.is_option
    ? Number(position.unrealized_pl ?? 0)
    : (marketVal - costBasis);

  const plpcVal = costBasis > 0 ? (plVal / costBasis) : Number(position.unrealized_plpc ?? 0);
  const isProfitable = plVal >= 0;

  // Risk guardrail thresholds
  const tpPrice = entryPrice > 0 ? entryPrice * 1.5 : currPrice * 1.5;
  const slPrice = entryPrice > 0 ? entryPrice * 0.75 : currPrice * 0.75;

  const handleExecuteClose = async () => {
    await onClosePosition(position.symbol);
    setShowConfirmClose(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-[#131315] border border-[#2b2a2c] rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-[#2b2a2c] bg-[#18181b]/90 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#27272a] border border-[#3f3f46] flex items-center justify-center text-[#facc15] font-black text-sm shadow-inner">
              <span className="material-symbols-outlined text-xl">
                {position.is_option ? 'tune' : isCrypto ? 'currency_bitcoin' : 'trending_up'}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-mono font-black text-lg text-[#e4e4e7] tracking-tight">
                  {position.symbol}
                </h2>
                {position.is_option ? (
                  <span className="px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-400 text-[10px] font-bold uppercase tracking-wider">
                    {position.option_type?.toUpperCase() || 'OPTION'} @ ${position.strike_price || '—'}
                  </span>
                ) : isCrypto ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs" style={{ fontSize: '11px' }}>currency_bitcoin</span>
                    CRYPTO 24/7
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[10px] font-bold uppercase tracking-wider">
                    US EQUITY
                  </span>
                )}
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#10b981]/15 border border-[#10b981]/30 text-[#10b981] text-[10px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                  <span>ACTIVE HOLDING</span>
                </div>
              </div>
              <p className="text-xs text-[#a1a1aa] flex items-center gap-2 mt-0.5">
                <span>Primary Feed: <strong className="text-[#e4e4e7] font-mono">{formattedTvSymbol}</strong></span>
                <span>•</span>
                <span>{isCrypto ? 'Alpaca 24/7 Spot Crypto' : 'Alpaca Paper Account'}</span>
                <span>•</span>
                <span>Position Entry: <strong className="text-[#facc15] font-mono">${entryPrice.toFixed(2)}</strong></span>
              </p>
            </div>
          </div>

          {/* Quick Performance & Controls */}
          <div className="flex items-center gap-3 ml-auto">
            {/* Live Price & PnL Banner */}
            <div className="text-right px-3 py-1.5 rounded-xl bg-[#141416] border border-[#2b2a2c]">
              <div className="text-sm font-black font-mono text-[#e4e4e7] flex items-center justify-end gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                <span>${currPrice.toFixed(2)}</span>
              </div>
              <div className={`text-[11px] font-bold flex items-center justify-end gap-1 ${isProfitable ? 'text-[#10b981]' : 'text-rose-400'}`}>
                <span>{isProfitable ? '+' : ''}${plVal.toFixed(2)}</span>
                <span>({isProfitable ? '+' : ''}{(plpcVal * 100).toFixed(2)}%)</span>
              </div>
            </div>

            {/* Close 'X' Button */}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-[#27272a]/70 hover:bg-[#3f3f46] text-[#a1a1aa] hover:text-white flex items-center justify-center transition-all cursor-pointer border border-[#3f3f46]/60"
              title="Close modal (Escape)"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 space-y-5 max-h-[calc(88vh-140px)] overflow-y-auto">
          {/* 1. Live Graph Panel */}
          <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl overflow-hidden shadow-lg">
            {/* Chart Toolbar */}
            <div className="px-4 py-2.5 bg-[#141416] border-b border-[#2b2a2c] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#facc15] text-base">show_chart</span>
                <span className="font-bold text-[#e4e4e7]">Live Market Graph</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#27272a] text-[#facc15] font-mono font-bold border border-[#3f3f46]">
                  {formattedTvSymbol} • Real-Time Stream
                </span>
                {position.is_option && (
                  <span className="text-[10px] text-[#facc15] bg-[#facc15]/10 px-2 py-0.5 rounded border border-[#facc15]/20">
                    Option Underlier
                  </span>
                )}
                {isCrypto && (
                  <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs" style={{ fontSize: '12px' }}>currency_bitcoin</span>
                    24/7 Spot Feed
                  </span>
                )}
              </div>

              <div className="flex items-center gap-4">
                {/* Timeframe selector */}
                <div className="flex items-center bg-[#1e1e22] rounded-lg p-0.5 border border-[#2b2a2c]">
                  {[
                    { label: '1m', val: '1' },
                    { label: '5m', val: '5' },
                    { label: '15m', val: '15' },
                    { label: '1h', val: '60' },
                    { label: '1D', val: 'D' },
                    { label: '1W', val: 'W' },
                  ].map((tf) => (
                    <button
                      key={tf.val}
                      type="button"
                      onClick={() => setChartInterval(tf.val)}
                      className={`px-2 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                        chartInterval === tf.val
                          ? 'bg-[#facc15] text-[#131315] shadow-xs'
                          : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                      }`}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>

                {/* Chart Style selector */}
                <div className="flex items-center bg-[#1e1e22] rounded-lg p-0.5 border border-[#2b2a2c]">
                  {[
                    { label: 'Candles', val: '1' as const },
                    { label: 'Area', val: '8' as const },
                    { label: 'Line', val: '3' as const },
                  ].map((st) => (
                    <button
                      key={st.val}
                      type="button"
                      onClick={() => setChartStyle(st.val)}
                      className={`px-2 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                        chartStyle === st.val
                          ? 'bg-[#27272a] text-[#facc15] border border-[#3f3f46]'
                          : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* TradingView Chart Container */}
            <div className="w-full h-[360px] bg-[#131315] relative">
              <TradingViewChart
                symbol={formattedTvSymbol}
                interval={chartInterval}
                chartStyle={chartStyle}
              />
            </div>
          </div>

          {/* Live Data Sync & Reconciliation Strip */}
          <div className="px-4 py-2.5 rounded-xl bg-[#18181b] border border-[#2b2a2c] flex flex-wrap items-center justify-between gap-3 text-xs shadow-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse shrink-0" />
              <span className="text-[#a1a1aa]">Real-Time Market Sync:</span>
              <span className="font-mono text-[#e4e4e7] font-bold">
                {qtyVal} {position.is_option ? 'Contracts' : isCrypto ? 'Tokens' : 'Shares'} @ ${currPrice.toFixed(2)}
              </span>
              <span className="text-[#71717a] font-mono text-[11px]">
                (Bought at ${entryPrice.toFixed(2)})
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono ml-auto">
              <span className="text-[#a1a1aa]">Net Unrealized P&L:</span>
              <span className={`font-black px-2 py-0.5 rounded ${isProfitable ? 'bg-[#10b981]/15 text-[#10b981]' : 'bg-rose-500/15 text-rose-400'}`}>
                {isProfitable ? '+' : ''}${plVal.toFixed(2)} ({isProfitable ? '+' : ''}{(plpcVal * 100).toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* 2. Realtime Data & Holding Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Valuation & Position Size */}
            <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-4 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-[#a1a1aa] mb-2">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Position Size & Basis</span>
                <span className="material-symbols-outlined text-sm text-[#3b82f6]">pie_chart</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Quantity:</span>
                  <span className="font-mono font-bold text-sm text-[#e4e4e7]">{qtyVal} {position.is_option ? 'Contracts' : isCrypto ? 'Tokens' : 'Shares'}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Avg Entry Price:</span>
                  <span className="font-mono font-bold text-sm text-[#e4e4e7]">${entryPrice.toFixed(2)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Total Cost Basis:</span>
                  <span className="font-mono font-bold text-sm text-[#a1a1aa]">${costBasis.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            {/* Card 2: Current Valuation & Market Worth */}
            <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-4 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-[#a1a1aa] mb-2">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Market Valuation</span>
                <span className="material-symbols-outlined text-sm text-[#10b981]">account_balance_wallet</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Current Price:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                    <span className="font-mono font-black text-sm text-[#e4e4e7]">${currPrice.toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Current Market Value:</span>
                  <span className="font-mono font-black text-sm text-[#10b981]">${marketVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Est. Breakeven:</span>
                  <span className="font-mono font-bold text-sm text-[#a1a1aa]">${entryPrice.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Card 3: Unrealized P&L */}
            <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-4 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-[#a1a1aa] mb-2">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Unrealized Performance</span>
                <span className={`material-symbols-outlined text-sm ${isProfitable ? 'text-[#10b981]' : 'text-rose-400'}`}>
                  {isProfitable ? 'trending_up' : 'trending_down'}
                </span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Net Profit / Loss:</span>
                  <span className={`font-mono font-black text-base ${isProfitable ? 'text-[#10b981]' : 'text-rose-400'}`}>
                    {isProfitable ? '+' : ''}${plVal.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Return %:</span>
                  <span className={`font-mono font-bold text-sm ${isProfitable ? 'text-[#10b981]' : 'text-rose-400'}`}>
                    {isProfitable ? '+' : ''}{(plpcVal * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Status:</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isProfitable ? 'bg-[#10b981]/20 text-[#10b981]' : 'bg-rose-500/20 text-rose-400'}`}>
                    {isProfitable ? 'IN PROFIT' : 'DRAWDOWN'}
                  </span>
                </div>
              </div>
            </div>

            {/* Card 4: Guardian Risk & Exit Policy */}
            <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-4 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-[#a1a1aa] mb-2">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Guardian Policy</span>
                <span className="material-symbols-outlined text-sm text-[#facc15]">shield</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Action Verdict:</span>
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                      position.recommendation === 'TAKE_PROFIT'
                        ? 'bg-[#10b981]/20 text-[#10b981] border-[#10b981]/40 animate-pulse'
                        : position.recommendation === 'STOP_LOSS'
                        ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
                        : position.recommendation === 'EXPIRATION_GUARD'
                        ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                        : 'bg-[#27272a] text-[#a1a1aa] border-[#3f3f46]'
                    }`}
                  >
                    {position.recommendation || 'HOLD'}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Take-Profit (+50%):</span>
                  <span className="font-mono font-bold text-xs text-[#10b981]">${tpPrice.toFixed(2)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-[#a1a1aa]">Stop-Loss (-25%):</span>
                  <span className="font-mono font-bold text-xs text-rose-400">${slPrice.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Detailed Contract & Intelligence Specs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Position & Contract Specifications */}
            <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="text-xs font-bold text-[#e4e4e7] uppercase tracking-wider flex items-center gap-2">
                <span className="material-symbols-outlined text-[#3b82f6] text-base">info</span>
                <span>Instrument & Execution Details</span>
              </h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 rounded-lg bg-[#141416] border border-[#27272a]">
                  <span className="text-[10px] text-[#a1a1aa] block mb-0.5">Asset Class</span>
                  <span className="font-semibold text-[#e4e4e7]">{position.is_option ? 'OCC Standard Option' : 'US Equity Stock'}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-[#141416] border border-[#27272a]">
                  <span className="text-[10px] text-[#a1a1aa] block mb-0.5">Brokerage Venue</span>
                  <span className="font-semibold text-[#10b981]">Alpaca Paper (FastMCP)</span>
                </div>
                {position.is_option ? (
                  <>
                    <div className="p-2.5 rounded-lg bg-[#141416] border border-[#27272a]">
                      <span className="text-[10px] text-[#a1a1aa] block mb-0.5">Strike & Type</span>
                      <span className="font-semibold text-[#facc15]">${position.strike_price} {position.option_type?.toUpperCase()}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#141416] border border-[#27272a]">
                      <span className="text-[10px] text-[#a1a1aa] block mb-0.5">Days to Expiration</span>
                      <span className="font-semibold text-[#e4e4e7]">{position.days_to_expiration != null ? `${position.days_to_expiration} days` : 'N/A'}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#141416] border border-[#27272a] col-span-2">
                      <span className="text-[10px] text-[#a1a1aa] block mb-0.5">Expiration Date</span>
                      <span className="font-mono text-[#e4e4e7]">{position.expiration_date || 'Standard Monthly Expiry'}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-2.5 rounded-lg bg-[#141416] border border-[#27272a]">
                      <span className="text-[10px] text-[#a1a1aa] block mb-0.5">Underlying Ticker</span>
                      <span className="font-mono font-bold text-[#e4e4e7]">{chartSymbol}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#141416] border border-[#27272a]">
                      <span className="text-[10px] text-[#a1a1aa] block mb-0.5">Trading Hours</span>
                      <span className="font-semibold text-[#e4e4e7]">9:30 AM - 4:00 PM EST</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Autonomous Guardian Thesis & Reason */}
            <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-5 shadow-sm space-y-3 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-[#e4e4e7] uppercase tracking-wider flex items-center gap-2 mb-2.5">
                  <span className="material-symbols-outlined text-[#10b981] text-base">smart_toy</span>
                  <span>PositionManagerAgent Intelligence Thesis</span>
                </h3>
                <div className="p-3.5 rounded-lg bg-[#141416] border border-[#27272a] text-xs leading-relaxed text-[#d4d4d8]">
                  {position.action_reason || (
                    `Position is currently within established risk safety limits (${(plpcVal * 100).toFixed(1)}% unrealized return). Continuously monitored for +50% Take-Profit target ($${tpPrice.toFixed(2)}) or -25% Stop-Loss protection ($${slPrice.toFixed(2)}).`
                  )}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20 flex items-center justify-between text-xs text-[#10b981]">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
                  <span className="font-semibold text-[11px]">Real-Time Autonomous Oversight Active</span>
                </div>
                <span className="text-[10px] text-[#a1a1aa] font-mono">FastMCP Protocol</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Action Bar */}
        <div className="px-6 py-4 border-t border-[#2b2a2c] bg-[#18181b] flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-[#a1a1aa] flex items-center gap-2">
            <span className="material-symbols-outlined text-[#10b981] text-base">verified</span>
            <span>Position liquidations are routed directly through Alpaca Paper Trading API.</span>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            {/* Dedicated CLOSE / LIQUIDATE POSITION Button with Confirmation */}
            {showConfirmClose ? (
              <div className="flex items-center gap-2 p-1.5 bg-rose-950/40 border border-rose-500/50 rounded-xl">
                <div className="text-xs text-rose-300 font-bold px-2 flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm text-rose-400">warning</span>
                  <span>Liquidate {position.qty} {position.symbol} via Market Sell?</span>
                </div>
                <button
                  type="button"
                  onClick={handleExecuteClose}
                  disabled={isClosing}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-black text-xs transition-all flex items-center gap-1 shadow cursor-pointer disabled:opacity-50 active:scale-95"
                >
                  {isClosing ? (
                    <>
                      <span className="material-symbols-outlined text-sm animate-spin">refresh</span>
                      <span>Liquidating...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-sm">sell</span>
                      <span>Confirm Market Sell</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirmClose(false)}
                  disabled={isClosing}
                  className="px-2.5 py-1.5 rounded-lg bg-[#27272a] hover:bg-[#3f3f46] text-[#a1a1aa] hover:text-white text-xs font-semibold cursor-pointer"
                >
                  Keep Position
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowConfirmClose(true)}
                disabled={isClosing}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-all flex items-center gap-1.5 shadow-lg shadow-rose-900/40 cursor-pointer disabled:opacity-50 active:scale-95"
              >
                <span className="material-symbols-outlined text-sm">sell</span>
                <span>{isClosing ? 'Liquidating...' : 'Liquidate / Sell Position'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HoldingDetailModal;
