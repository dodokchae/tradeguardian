'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import AIOpportunity from './pages/ai_opportunity';
import PositionsManagerPage from './pages/positions_manager';
import DashboardPage, { ProposedTradeDetails } from './pages/dashboard';
import SettingsPage from './pages/settings';
import { Sidebar } from './components/Sidebar';
import { TradingViewChart } from '../components/TradingViewChart';
import AlpacaCliModal from './components/AlpacaCliModal';
import AgentDeliberationModal from './components/AgentDeliberationModal';

// 1. Backend API Response Interfaces
interface BackendRiskCheckItem {
  status: 'PASS' | 'FAIL';
  reason: string;
}

interface BackendAnalysisResponse {
  message: string;
  proposal: {
    symbol: string;
    side: string;
    quantity: number;
    current_price: number;
    trade_value: number;
    suggested_safe_quantity?: number | null;
  };
  risk_metrics: {
    account_equity: number;
    buying_power: number;
    trade_percent_of_equity: number;
    existing_position_value: number;
    projected_position_value: number;
    projected_concentration_percent: number;
  };
  risk_checks: {
    exposure: BackendRiskCheckItem;
    concentration: BackendRiskCheckItem;
    buying_power: BackendRiskCheckItem;
    position: BackendRiskCheckItem;
  };
  decision: {
    status: 'APPROVED' | 'BLOCKED' | 'WARNING';
    reasons: string[];
  };
}

// Alpaca Asset Structure
interface AlpacaAsset {
  symbol: string;
  name: string;
  exchange: string;
  asset_class: 'us_equity' | 'crypto';
  price: number;
  change: string;
  tradable?: boolean;
}

/**
 * Format dollar price dynamically preserving high precision for sub-dollar crypto / penny stocks
 */
export function formatAssetPrice(price: number | string | undefined | null): string {
  if (price === undefined || price === null || price === '') return '0.00';
  const num = Number(price);
  if (isNaN(num) || num <= 0) return '0.00';
  if (num < 0.0001) return num.toFixed(6);
  if (num < 0.01) return num.toFixed(5);
  if (num < 1) return num.toFixed(4);
  if (num < 10) return num.toFixed(3);
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Comprehensive Alpaca Market Universe (Equities, ETFs, Crypto)
const DEFAULT_ALPACA_ASSETS: AlpacaAsset[] = [
  // Mega-cap & Tech
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', asset_class: 'us_equity', price: 228.45, change: '+1.42%' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', asset_class: 'us_equity', price: 119.30, change: '+3.15%' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', exchange: 'NASDAQ', asset_class: 'us_equity', price: 214.11, change: '-0.85%' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', asset_class: 'us_equity', price: 418.00, change: '+0.65%' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', exchange: 'NASDAQ', asset_class: 'us_equity', price: 178.50, change: '+1.10%' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ', asset_class: 'us_equity', price: 163.20, change: '+0.34%' },
  { symbol: 'META', name: 'Meta Platforms, Inc.', exchange: 'NASDAQ', asset_class: 'us_equity', price: 512.60, change: '+2.05%' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', exchange: 'NASDAQ', asset_class: 'us_equity', price: 148.70, change: '+1.88%' },
  { symbol: 'NFLX', name: 'Netflix, Inc.', exchange: 'NASDAQ', asset_class: 'us_equity', price: 685.20, change: '+0.95%' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', exchange: 'NASDAQ', asset_class: 'us_equity', price: 164.50, change: '+2.40%' },
  { symbol: 'INTC', name: 'Intel Corporation', exchange: 'NASDAQ', asset_class: 'us_equity', price: 21.10, change: '-1.25%' },
  { symbol: 'PLTR', name: 'Palantir Technologies', exchange: 'NYSE', asset_class: 'us_equity', price: 31.40, change: '+4.12%' },
  { symbol: 'COIN', name: 'Coinbase Global, Inc.', exchange: 'NASDAQ', asset_class: 'us_equity', price: 188.90, change: '+3.60%' },
  
  // Market ETFs
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', exchange: 'NYSE', asset_class: 'us_equity', price: 552.14, change: '+0.45%' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', exchange: 'NASDAQ', asset_class: 'us_equity', price: 472.88, change: '+0.91%' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', exchange: 'NYSE', asset_class: 'us_equity', price: 215.30, change: '+1.15%' },
  { symbol: 'VXX', name: 'iPath Series B S&P 500 VIX', exchange: 'BATS', asset_class: 'us_equity', price: 12.80, change: '-2.40%' },
  
  // Major Bluechips & Financials
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', exchange: 'NYSE', asset_class: 'us_equity', price: 218.40, change: '+0.52%' },
  { symbol: 'BAC', name: 'Bank of America Corp', exchange: 'NYSE', asset_class: 'us_equity', price: 39.75, change: '+0.25%' },
  { symbol: 'GS', name: 'Goldman Sachs Group Inc', exchange: 'NYSE', asset_class: 'us_equity', price: 492.10, change: '+0.78%' },
  { symbol: 'V', name: 'Visa Inc.', exchange: 'NYSE', asset_class: 'us_equity', price: 278.30, change: '+0.15%' },
  { symbol: 'WMT', name: 'Walmart Inc.', exchange: 'NYSE', asset_class: 'us_equity', price: 74.90, change: '+0.60%' },
  { symbol: 'DIS', name: 'The Walt Disney Company', exchange: 'NYSE', asset_class: 'us_equity', price: 92.40, change: '-0.30%' },
  { symbol: 'BA', name: 'Boeing Co.', exchange: 'NYSE', asset_class: 'us_equity', price: 162.80, change: '-1.45%' },
  
  // Alpaca Supported Crypto Markets
  { symbol: 'BTC/USD', name: 'Bitcoin / US Dollar', exchange: 'CRYPTO', asset_class: 'crypto', price: 58420.00, change: '+1.80%' },
  { symbol: 'ETH/USD', name: 'Ethereum / US Dollar', exchange: 'CRYPTO', asset_class: 'crypto', price: 2510.50, change: '-0.40%' },
  { symbol: 'SOL/USD', name: 'Solana / US Dollar', exchange: 'CRYPTO', asset_class: 'crypto', price: 134.20, change: '+4.25%' },
  { symbol: 'DOGE/USD', name: 'Dogecoin / US Dollar', exchange: 'CRYPTO', asset_class: 'crypto', price: 0.102, change: '+2.10%' },
  { symbol: 'AVAX/USD', name: 'Avalanche / US Dollar', exchange: 'CRYPTO', asset_class: 'crypto', price: 24.80, change: '+3.15%' },
  { symbol: 'LINK/USD', name: 'Chainlink / US Dollar', exchange: 'CRYPTO', asset_class: 'crypto', price: 11.45, change: '+1.60%' },
  { symbol: 'UNI/USD', name: 'Uniswap / US Dollar', exchange: 'CRYPTO', asset_class: 'crypto', price: 6.80, change: '-0.90%' },
];

interface TimeframeOptionItem {
  label: string;
  value: string;
}

// Fixed: Allow string category name to prevent TypeScript compilation errors
interface TimeframeCategory {
  category: string;
  items: TimeframeOptionItem[];
}

const TIMEFRAME_CATEGORIES: TimeframeCategory[] = [
  {
    category: 'Minutes (Live Streaming)',
    items: [
      { label: '1m (Live)', value: '1' },
      { label: '3m', value: '3' },
      { label: '5m', value: '5' },
      { label: '15m', value: '15' },
      { label: '30m', value: '30' },
      { label: '45m', value: '45' },
    ],
  },
  {
    category: 'Hour',
    items: [
      { label: '1h', value: '60' },
      { label: '2h', value: '120' },
      { label: '4h', value: '240' },
    ],
  },
  {
    category: 'Day',
    items: [{ label: '1D', value: 'D' }],
  },
  {
    category: 'Week',
    items: [{ label: '1W', value: 'W' }],
  },
  {
    category: 'Months',
    items: [
      { label: '1M', value: 'M' },
      { label: '3M', value: '3M' },
      { label: '6M', value: '6M' },
    ],
  },
  {
    category: 'Years',
    items: [{ label: '1Y', value: '12M' }],
  },
];

/**
 * REQUIREMENT #2: Virtualized Symbol Dropdown List
 * Only renders items currently within view inside the scrollable container.
 * Unloads off-screen elements from the DOM and dynamically loads elements as they scroll into view.
 */
function VirtualSymbolList({
  assets,
  selectedSymbol,
  onSelect,
}: {
  assets: AlpacaAsset[];
  selectedSymbol: string;
  onSelect: (asset: AlpacaAsset) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState<number>(0);
  const ITEM_HEIGHT = 48;
  const CONTAINER_HEIGHT = 256;
  const BUFFER = 4;

  const totalCount = assets.length;
  const totalHeight = totalCount * ITEM_HEIGHT + 8;

  // Reset scroll position when assets change (e.g. searching)
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    setScrollTop(0);
  }, [assets]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
  const endIndex = Math.min(
    totalCount,
    Math.ceil((scrollTop + CONTAINER_HEIGHT) / ITEM_HEIGHT) + BUFFER
  );

  const visibleAssets = assets.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="overflow-y-auto h-full custom-scrollbar pr-1 pt-1"
      style={{ height: `${CONTAINER_HEIGHT}px`, position: 'relative' }}
    >
      <div style={{ height: `${totalHeight}px`, position: 'relative', width: '100%' }}>
        {visibleAssets.map((asset, idx) => {
          const itemIndex = startIndex + idx;
          const itemTop = itemIndex * ITEM_HEIGHT + 2;
          const isSelected = selectedSymbol === asset.symbol;
          return (
            <button
              key={`${asset.symbol}-${asset.exchange}-${itemIndex}`}
              type="button"
              style={{
                position: 'absolute',
                top: `${itemTop}px`,
                left: 0,
                right: '4px',
                height: `${ITEM_HEIGHT - 4}px`,
              }}
              onClick={() => onSelect(asset)}
              className={`flex items-center justify-between p-2 rounded-md transition-colors text-left ${
                isSelected
                  ? 'bg-[#facc15]/10 border-l-2 border-[#facc15] text-[#facc15]'
                  : 'hover:bg-[#1c1b1d] text-[#e4e4e7]'
              }`}
            >
              <div className="truncate mr-2">
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <span>{asset.symbol}</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-[#0e0e10] border border-[#2b2a2c] text-[#a1a1aa] font-normal">
                    {asset.exchange.replace(/^ASSETEXCHANGE\./i, '').split('.').pop() || 'US'}
                  </span>
                </div>
                <div className="text-[10px] text-[#a1a1aa] font-medium truncate max-w-[150px]">
                  {asset.name}
                </div>
              </div>
              <div className="text-right shrink-0">
                {asset?.price && Number(asset.price) > 0 ? (
                  <>
                    <div className="text-xs font-semibold font-mono">
                      ${Number(asset.price).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: Number(asset.price) < 1 ? 4 : 2,
                      })}
                    </div>
                    <div
                      className={`text-[10px] font-medium font-mono ${
                        (asset?.change || '').startsWith('+')
                          ? 'text-[#10b981]'
                          : (asset?.change || '').startsWith('-')
                          ? 'text-red-400'
                          : 'text-[#71717a]'
                      }`}
                    >
                      {asset?.change && asset.change !== '0.00%' ? asset.change : '0.00%'}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-end gap-1.5 py-0.5">
                    <div className="h-3 w-12 bg-[#27272a] rounded animate-pulse" />
                    <div className="h-2 w-8 bg-[#27272a]/60 rounded animate-pulse" />
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function TradeAnalysisPage() {
  const [isOrderTypeDropdownOpen, setIsOrderTypeDropdownOpen] = useState<boolean>(false);
  const orderTypeDropdownRef = useRef<HTMLDivElement>(null);
  const [currentView, setCurrentView] = useState<'dashboard' | 'analysis' | 'ai_opportunity' | 'positions' | 'settings'>('dashboard');
  const [isExecutingTrade, setIsExecutingTrade] = useState<boolean>(false);
  const [tradeExecutionMessage, setTradeExecutionMessage] = useState<string | null>(null);
  const [tradeExecutionSuccess, setTradeExecutionSuccess] = useState<boolean>(false);
  const [isCliModalOpen, setIsCliModalOpen] = useState<boolean>(false);
  const [isDeliberationModalOpen, setIsDeliberationModalOpen] = useState<boolean>(false);
  
  // Selected Timeframe state
  const [selectedTimeframe, setSelectedTimeframe] = useState<TimeframeOptionItem>({
    label: '1m (Live)',
    value: '1',
  });
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState<boolean>(false);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);

  // '8' = Heikin-Ashi (Continuous Candles), '1' = Standard Candles, '3' = Area
  const [chartStyle, setChartStyle] = useState<'8' | '1' | '3'>('8');

  // Alpaca Assets & Symbol Selector state
  const [allAssets, setAllAssets] = useState<AlpacaAsset[]>(DEFAULT_ALPACA_ASSETS);
  const [selectedAsset, setSelectedAsset] = useState<AlpacaAsset>(DEFAULT_ALPACA_ASSETS[0]);
  const [isSymbolDropdownOpen, setIsSymbolDropdownOpen] = useState<boolean>(false);
  const [symbolSearch, setSymbolSearch] = useState<string>('');
  const [isLoadingAssets, setIsLoadingAssets] = useState<boolean>(false);
  const symbolDropdownRef = useRef<HTMLDivElement>(null);

  // Trade form inputs
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState<number>(10);
  const [orderType, setOrderType] = useState<string>('Market');
  const [entryMode, setEntryMode] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [limitPrice, setLimitPrice] = useState<string>('228.45');
  const [stopLoss, setStopLoss] = useState<string>('2.4% ($222.97)');
  const [takeProfit, setTakeProfit] = useState<string>('5.8% ($241.70)');

  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<BackendAnalysisResponse | null>(null);

  // Live account data for Sidebar
  const [accountEquity, setAccountEquity] = useState<string | null>(null);
  const [accountBuyingPower, setAccountBuyingPower] = useState<string | null>(null);
  const [accountOpenPositions, setAccountOpenPositions] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ref to track current selected symbol for use inside closures
  const selectedSymbolRef = useRef<string>(selectedAsset.symbol);
  useEffect(() => { selectedSymbolRef.current = selectedAsset.symbol; }, [selectedAsset.symbol]);
  const isExecutingTradeRef = useRef<boolean>(false);

  // Fetch live Alpaca assets from backend (on mount + 30s polling for live prices)
  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    async function loadAlpacaAssets() {
      try {
        const res = await fetch(`${backendUrl}/assets/`, { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            const defaultMap = new Map<string, AlpacaAsset>(DEFAULT_ALPACA_ASSETS.map((a) => [a.symbol, a]));
            const popularSymbols = new Set(DEFAULT_ALPACA_ASSETS.map((a) => a.symbol));

            const sanitized: AlpacaAsset[] = data.map((a: any) => {
              const sym = String(a.symbol || '').trim().toUpperCase();
              const def = defaultMap.get(sym);
              const rawPrice = Number(a.price || 0);
              const price = rawPrice > 0 ? rawPrice : (def?.price || 0);
              const rawChange = String(a.change || '0.00%');
              const change = rawChange && rawChange !== '0.00%' ? rawChange : (def?.change || '0.00%');
              return {
                symbol: sym,
                name: String(a.name || def?.name || a.symbol || ''),
                exchange: String(a.exchange || def?.exchange || 'US').replace(/^ASSETEXCHANGE\./i, '').split('.').pop() || 'US',
                asset_class: String(a.asset_class || '').toLowerCase().includes('crypto') ? 'crypto' : 'us_equity',
                price,
                change,
              };
            });

            // Ensure popular liquid assets and assets with valid prices come first
            sanitized.sort((a, b) => {
              const aPop = popularSymbols.has(a.symbol) ? 0 : 1;
              const bPop = popularSymbols.has(b.symbol) ? 0 : 1;
              if (aPop !== bPop) return aPop - bPop;
              if (a.price > 0 && b.price <= 0) return -1;
              if (a.price <= 0 && b.price > 0) return 1;
              return a.symbol.localeCompare(b.symbol);
            });

            setAllAssets(sanitized);
            // Always update selectedAsset with the latest sanitized price and exchange
            const currentSymbol = selectedSymbolRef.current;
            const match = sanitized.find((a: AlpacaAsset) => a.symbol === currentSymbol);
            if (match) {
              setSelectedAsset((prev) => ({
                ...prev,
                exchange: match.exchange || prev.exchange,
                price: match.price > 0 ? match.price : prev.price,
                change: match.change || prev.change,
              }));
            }
          }
        }
      } catch (err) {
        // Fallback gracefully to DEFAULT_ALPACA_ASSETS
      }
    }
    loadAlpacaAssets();
    const interval = setInterval(loadAlpacaAssets, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch live account data for Sidebar (on mount + 30s polling + instant events)
  const fetchAccountData = useCallback(async () => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    try {
      const [accRes, portRes] = await Promise.all([
        fetch(`${backendUrl}/account/`),
        fetch(`${backendUrl}/portfolio/`),
      ]);
      if (accRes.ok) {
        const accData = await accRes.json();
        setAccountEquity(accData.equity);
        setAccountBuyingPower(accData.buying_power);
      }
      if (portRes.ok) {
        const portData = await portRes.json();
        setAccountOpenPositions(Array.isArray(portData.positions) ? portData.positions.length : 0);
      }
    } catch {
      // Silently fail — sidebar will show loading state
    }
  }, []);

  useEffect(() => {
    fetchAccountData();
    const interval = setInterval(fetchAccountData, 30000);

    const handleAccountUpdate = () => {
      fetchAccountData();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('tradeguardian:account_updated', handleAccountUpdate);
    }

    return () => {
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('tradeguardian:account_updated', handleAccountUpdate);
      }
    };
  }, [fetchAccountData]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (timeframeDropdownRef.current && !timeframeDropdownRef.current.contains(event.target as Node)) {
        setIsTimeframeDropdownOpen(false);
      }
      if (symbolDropdownRef.current && !symbolDropdownRef.current.contains(event.target as Node)) {
        setIsSymbolDropdownOpen(false);
      }
      if (orderTypeDropdownRef.current && !orderTypeDropdownRef.current.contains(event.target as Node)) {
        setIsOrderTypeDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Trigger ghost loading simulation on symbol dropdown open
  const handleOpenSymbolDropdown = () => {
    setIsSymbolDropdownOpen((prev) => {
      const next = !prev;
      if (next) {
        setSymbolSearch('');
        setIsLoadingAssets(true);
        setTimeout(() => {
          setIsLoadingAssets(false);
        }, 150);
      }
      return next;
    });
  };

  // Filtered Assets based on live search
  const filteredAssets = useMemo(() => {
    const query = symbolSearch.trim().toLowerCase();
    if (!query) return allAssets;
    return allAssets.filter(
      (a) =>
        a.symbol.toLowerCase().includes(query) ||
        a.name.toLowerCase().includes(query) ||
        a.exchange.toLowerCase().includes(query)
    );
  }, [symbolSearch, allAssets]);

  // Dynamically fetch live Alpaca snapshots for searched symbols lacking prices
  useEffect(() => {
    const query = symbolSearch.trim().toUpperCase();
    if (!query || filteredAssets.length === 0) return;

    // Collect symbols from top 15 filtered results that need pricing
    const neededSymbols = filteredAssets
      .slice(0, 15)
      .filter((a) => !a.price || Number(a.price) <= 0)
      .map((a) => a.symbol);

    if (neededSymbols.length === 0) return;

    const timer = setTimeout(async () => {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
        const res = await fetch(`${backendUrl}/assets/snapshots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: neededSymbols }),
        });
        if (res.ok) {
          const snapshots: Record<string, { price: number; change: string }> = await res.json();
          if (snapshots && Object.keys(snapshots).length > 0) {
            setAllAssets((prev) =>
              prev.map((asset) => {
                const snap = snapshots[asset.symbol] || snapshots[asset.symbol.replace('/', '')];
                if (snap && snap.price > 0) {
                  return {
                    ...asset,
                    price: snap.price,
                    change: snap.change || asset.change,
                  };
                }
                return asset;
              })
            );
          }
        }
      } catch {
        // Silently ignore network failures
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [symbolSearch, filteredAssets]);

  // Fixed: Valid TradingView Exchange Formatter (COINBASE for crypto, proper primary US exchange)
  const formattedTradingViewSymbol = useMemo(() => {
    const s = (selectedAsset.symbol || '').trim().toUpperCase();
    if (!s) return 'NASDAQ:NVDA';
    if (s.includes(':')) return s;
    const isCrypto =
      selectedAsset.asset_class === 'crypto' ||
      s.includes('/') ||
      ['BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'UNI', 'ADA', 'DOT', 'NEAR', 'MATIC', 'XRP', 'LTC', 'BCH', 'SHIB', 'PEPE', 'SUI'].includes(
        s.replace(/[-_/]?(USD|USDT)$/i, '')
      );
    if (isCrypto) {
      const clean = s.replace('/', '').replace(/[-_/]?(USD|USDT)$/i, '');
      return `COINBASE:${clean}USD`;
    }

    // Clean exchange string of any SDK enum artifacts (e.g. "ASSETEXCHANGE.NASDAQ" -> "NASDAQ")
    let ex = (selectedAsset.exchange || '').toUpperCase().replace(/^ASSETEXCHANGE\./i, '').trim();
    if (ex.includes('.')) {
      ex = ex.split('.').pop() || '';
    }

    // Map regional market centers to TradingView identifiers
    if (ex === 'BATS' || ex === 'ARCA') {
      ex = 'AMEX';
    }

    // Common TradingView stock exchange prefixes
    if (['NASDAQ', 'NYSE', 'AMEX', 'OTC'].includes(ex)) {
      return `${ex}:${s}`;
    }

    // Default: TradingView automatically resolves ticker symbol to its primary exchange
    return s;
  }, [selectedAsset]);


  // TradeGuardian AI Risk Analysis Function
  const handleAnalyzeTrade = async (overrideQty?: number | any) => {
    setIsAnalyzing(true);
    setErrorMessage(null);
    // Reset execution state so button doesn't stay stuck as "Order Placed"
    setTradeExecutionSuccess(false);
    setTradeExecutionMessage(null);

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

    try {
      const cleanSymbol = selectedAsset.symbol.replace('/', '');
      
      // Determine the exact entry price target
      let targetPrice: number | undefined = undefined;
      if (entryMode === 'LIMIT' && limitPrice && !isNaN(Number(limitPrice)) && Number(limitPrice) > 0) {
        targetPrice = Number(limitPrice);
      } else if (selectedAsset?.price && Number(selectedAsset.price) > 0) {
        targetPrice = Number(selectedAsset.price);
      }

      const orderQty = typeof overrideQty === 'number' ? overrideQty : Number(quantity);

      const response = await fetch(`${backendUrl}/analyze/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: cleanSymbol.toUpperCase(),
          side: side.toLowerCase().includes('sell') ? 'sell' : 'buy',
          quantity: orderQty,
          entry_price: targetPrice,
          order_type: entryMode,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      const data: BackendAnalysisResponse = await response.json();
      setAnalysisResult(data);
      if (typeof overrideQty === 'number') {
        setQuantity(overrideQty);
      }
    } catch (err: any) {
      console.error('Error connecting to TradeGuardian backend:', err);
      setErrorMessage(err.message || 'Failed to connect to TradeGuardian API');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExecuteTradeViaMcp = async () => {
    if (!analysisResult || analysisResult.decision.status !== 'APPROVED') return;
    if (isExecutingTradeRef.current) return;
    isExecutingTradeRef.current = true;

    try {
      setIsExecutingTrade(true);
      setTradeExecutionMessage(null);

      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
      const symbol = selectedAsset.symbol;

      let parsedQty = Number(quantity);
      if (isNaN(parsedQty) || parsedQty <= 0) parsedQty = 1;

      let cleanLimitPrice: number | null = null;
      if (entryMode === 'LIMIT') {
        if (limitPrice) {
          const p = parseFloat(String(limitPrice).replace(/[^0-9.]/g, ''));
          if (!isNaN(p) && p > 0) cleanLimitPrice = p;
        }
        if (!cleanLimitPrice && selectedAsset?.price && Number(selectedAsset.price) > 0) {
          cleanLimitPrice = Number(selectedAsset.price);
        }
      }

      // Check if it's an actual OCC option contract symbol before populating option_symbol
      const isOptionContract = Boolean(
        (selectedAsset as any)?.is_option ||
        (symbol.length > 6 && /\d/.test(symbol) && !symbol.includes('/'))
      );

      const res = await fetch(`${backendUrl}/trade/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol,
          option_symbol: isOptionContract ? symbol : undefined,
          side: side.toLowerCase().includes('sell') ? 'sell' : 'buy',
          quantity: parsedQty,
          order_type: entryMode.toLowerCase(),
          limit_price: entryMode === 'LIMIT' ? cleanLimitPrice : undefined,
          source: 'Guardian Risk Desk',
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setTradeExecutionSuccess(true);
        setTradeExecutionMessage(`Order ${data.order?.id?.slice(0, 8) || 'accepted'} submitted via ${data.execution_engine}!`);

        // 1. Store highlight target and broadcast event immediately
        const targetSymbol = (data.order?.symbol || symbol || '').toUpperCase();
        const targetOrderId = data.order?.id || '';
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(
            'tradeguardian:highlight_target',
            JSON.stringify({ symbol: targetSymbol, orderId: targetOrderId, timestamp: Date.now() })
          );
          window.dispatchEvent(
            new CustomEvent('tradeguardian:highlight_order', {
              detail: { symbol: targetSymbol, orderId: targetOrderId },
            })
          );
          window.dispatchEvent(new CustomEvent('tradeguardian:account_updated'));
        }

        // 2. Clear clearance state on the risk desk
        setAnalysisResult(null);

        // 3. Immediately redirect user to Position Manager page
        setCurrentView('positions');

        // 4. Background non-blocking account data sync
        if (data.account) {
          if (data.account.equity) setAccountEquity(data.account.equity);
          if (data.account.buying_power) setAccountBuyingPower(data.account.buying_power);
        }
        fetchAccountData().catch(() => {});
        setTimeout(() => fetchAccountData().catch(() => {}), 1500);
      } else {
        setTradeExecutionSuccess(false);
        let errorText = 'Unknown error';
        if (typeof data.detail === 'string') {
          errorText = data.detail;
        } else if (Array.isArray(data.detail)) {
          errorText = data.detail.map((err: any) => err.msg || err.message || JSON.stringify(err)).join(', ');
        } else if (typeof data.detail === 'object' && data.detail !== null) {
          errorText = data.detail.message || data.detail.msg || data.detail.error || JSON.stringify(data.detail);
        } else if (data.message) {
          errorText = String(data.message);
        }
        setTradeExecutionMessage(`Execution failed: ${errorText}`);
      }
    } catch (err: any) {
      setTradeExecutionSuccess(false);
      setTradeExecutionMessage(`Error executing order: ${err?.message || 'Network error'}`);
    } finally {
      setIsExecutingTrade(false);
      isExecutingTradeRef.current = false;
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#131315] text-[#e4e4e7] font-sans antialiased">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap');

        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #131315;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }

        .tradingview-clean-chart,
        .tradingview-clean-chart *,
        .tradingview-clean-chart iframe {
          border: none !important;
          border-width: 0 !important;
          outline: none !important;
          box-shadow: none !important;
          background: #131315 !important;
          background-color: #131315 !important;
        }
      `}</style>

      {/* Trade Analysis View (persisted, hidden when ai_opportunity is active) */}
      <div className={`flex flex-1 overflow-hidden h-full ${currentView === 'analysis' ? 'flex' : 'hidden'}`}>
        {/* Sidebar */}
        <Sidebar
          activeTab={currentView}
          onNavigate={(tab) => setCurrentView(tab)}
          equity={accountEquity}
          buyingPower={accountBuyingPower}
          openPositions={accountOpenPositions}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col h-full bg-[#131315] overflow-hidden">
          {/* Main Header */}
          <header className="h-auto min-h-14 py-2 flex items-center justify-between px-3 sm:px-6 border-b border-[#2b2a2c] shrink-0 bg-[#131315] flex-wrap gap-2">
            <div className="flex items-center gap-2.5 sm:gap-6">
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('tradeguardian:open_mobile_drawer'));
                  }
                }}
                className="lg:hidden p-1.5 -ml-1 rounded-lg text-[#a1a1aa] hover:text-[#e4e4e7] hover:bg-[#1c1b1d] cursor-pointer"
                title="Open Navigation"
              >
                <span className="material-symbols-outlined text-xl">menu</span>
              </button>
              <h1 className="text-sm sm:text-base font-bold text-[#e4e4e7]">Trade Analysis</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#10b981]/10 border border-[#10b981]/40 text-[#10b981] text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                Alpaca MCP: Active (72 Tools)
              </div>
              <div className="hidden md:flex items-center gap-2 text-xs text-[#a1a1aa]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                Alpaca Paper Feed Connected
              </div>
              <button
                type="button"
                onClick={() => setIsCliModalOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#1c1b1d] hover:bg-[#27272a] border border-[#2b2a2c] hover:border-[#facc15] text-[#e4e4e7] text-xs font-semibold transition-all cursor-pointer shadow-sm"
              >
                <span className="material-symbols-outlined text-sm text-[#facc15]">terminal</span>
                <span>Alpaca CLI</span>
              </button>
              <button className="flex items-center gap-2 px-2.5 py-1 border border-[#facc15] text-[#facc15] rounded text-xs font-medium hover:bg-[#facc15]/10 transition-colors">
                Paper Account
                <svg fill="none" height="12" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="12">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            </div>
          </header>

          {/* Body: Middle & Right Panels */}
          <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden p-2.5 sm:p-4 gap-3 pb-20 lg:pb-4 custom-scrollbar">
            {/* Middle Panel */}
            <main className="flex flex-col min-w-0 flex-1 gap-3 shrink-0 lg:shrink">
              {/* Chart Panel */}
              <div className="bg-[#131315] border border-[#2b2a2c] rounded-lg p-3 sm:p-4 flex flex-col flex-1 min-h-[380px] sm:min-h-[440px] lg:min-h-0">
                <div className="flex items-start justify-between mb-2 shrink-0 gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold leading-tight">{selectedAsset.symbol}</h2>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#1c1b1d] border border-[#2b2a2c] text-[#a1a1aa]">
                        {selectedAsset.exchange.replace(/^ASSETEXCHANGE\./i, '').split('.').pop() || 'US'}
                      </span>
                      <span className="text-xs text-[#a1a1aa] font-medium hidden sm:inline">
                        {selectedAsset.name}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-lg font-bold">
                        ${formatAssetPrice(
                          (analysisResult?.proposal?.symbol === selectedAsset.symbol && analysisResult?.proposal?.current_price !== undefined)
                            ? analysisResult.proposal.current_price
                            : selectedAsset?.price
                        )}
                      </span>
                      <span
                        className={`text-xs font-medium ${
                          (selectedAsset?.change || '').startsWith('+')
                            ? 'text-[#10b981]'
                            : (selectedAsset?.change || '').startsWith('-')
                            ? 'text-red-400'
                            : 'text-[#a1a1aa]'
                        }`}
                      >
                        {selectedAsset?.change || '0.00%'}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-[#1c1b1d] border border-[#2b2a2c] text-[#a1a1aa] ml-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${selectedAsset.asset_class === 'crypto' ? 'bg-[#10b981] animate-ping' : 'bg-[#facc15]'}`} />
                        {selectedAsset.asset_class === 'crypto' ? '24/7 Live Ticking' : 'US Market Session'}
                      </span>
                    </div>
                  </div>
                  
                  {/* Top Toolbar */}
                  <div className="flex items-center gap-2.5 flex-wrap justify-end">
                    {/* Chart Style Toggle */}
                    <div className="flex items-center bg-[#1c1b1d] border border-[#2b2a2c] rounded-md p-0.5 shrink-0 shadow-inner">
                      <button
                        type="button"
                        onClick={() => setChartStyle('8')}
                        title="Continuous Heikin-Ashi Candlesticks"
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-all cursor-pointer ${
                          chartStyle === '8'
                            ? 'bg-[#facc15]/15 border border-[#facc15]/40 text-[#facc15] shadow-sm'
                            : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                        Continuous
                      </button>
                      <button
                        type="button"
                        onClick={() => setChartStyle('1')}
                        title="Standard Candlesticks"
                        className={`px-3 py-1.5 text-xs font-semibold rounded transition-all cursor-pointer ${
                          chartStyle === '1'
                            ? 'bg-[#facc15]/15 border border-[#facc15]/40 text-[#facc15] shadow-sm'
                            : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                        }`}
                      >
                        Standard
                      </button>
                      <button
                        type="button"
                        onClick={() => setChartStyle('3')}
                        title="Continuous Area Line"
                        className={`px-3 py-1.5 text-xs font-semibold rounded transition-all cursor-pointer ${
                          chartStyle === '3'
                            ? 'bg-[#facc15]/15 border border-[#facc15]/40 text-[#facc15] shadow-sm'
                            : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                        }`}
                      >
                        Area
                      </button>
                    </div>

                    {/* Timeframe Dropdown */}
                    <div className="relative" ref={timeframeDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setIsTimeframeDropdownOpen(!isTimeframeDropdownOpen)}
                        className={`flex items-center gap-2 px-3 py-1.5 bg-[#1c1b1d] border rounded-md text-xs font-semibold transition-all cursor-pointer shadow-inner ${
                          isTimeframeDropdownOpen
                            ? 'border-[#facc15] text-[#e4e4e7]'
                            : 'border-[#2b2a2c] text-[#a1a1aa] hover:text-[#e4e4e7] hover:border-[#3f3f46]'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5 text-[#facc15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span>
                          Timeframe:{' '}
                          <span className="text-[#facc15] font-bold tracking-wide">
                            {selectedTimeframe.label}
                          </span>
                        </span>
                        <svg
                          className={`w-3 h-3 text-[#a1a1aa] transition-transform duration-200 ${
                            isTimeframeDropdownOpen ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          viewBox="0 0 24 24"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>

                      {isTimeframeDropdownOpen && (
                        <div className="absolute right-0 top-full mt-2 w-72 bg-[#18181b] border border-[#2b2a2c] rounded-lg shadow-2xl p-3 z-50 max-h-[420px] overflow-y-auto custom-scrollbar">
                          <div className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider pb-2 mb-2 border-b border-[#2b2a2c] flex items-center justify-between">
                            <span>Select Timeframe</span>
                            <span className="text-[9px] text-[#facc15] font-normal">Active: {selectedTimeframe.label}</span>
                          </div>

                          <div className="space-y-3">
                            {TIMEFRAME_CATEGORIES.map((catGroup) => (
                              <div key={catGroup.category} className="space-y-1">
                                <div className="text-[10px] font-bold text-[#71717a] uppercase tracking-wider px-1">
                                  {catGroup.category}
                                </div>
                                <div className="grid grid-cols-4 gap-1">
                                  {catGroup.items.map((tfItem) => {
                                    const isSelected = selectedTimeframe.label === tfItem.label;
                                    return (
                                      <button
                                        key={tfItem.label}
                                        type="button"
                                        onClick={() => {
                                          setSelectedTimeframe(tfItem);
                                          setIsTimeframeDropdownOpen(false);
                                        }}
                                        className={`py-1.5 px-2 text-xs rounded font-medium transition-colors ${
                                          isSelected
                                            ? 'bg-[#facc15] text-[#131315] font-bold shadow-sm'
                                            : 'bg-[#0e0e10] text-[#e4e4e7] hover:bg-[#27272a] hover:text-[#facc15]'
                                        }`}
                                      >
                                        {tfItem.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* TradingView Chart Container */}
                <div className="flex-1 w-full min-h-0 relative overflow-hidden bg-[#131315] border-0 outline-none">
                  <TradingViewChart
                    symbol={formattedTradingViewSymbol}
                    interval={selectedTimeframe.value}
                    chartStyle={chartStyle}
                  />
                </div>
              </div>

              {/* Trade Details Panel */}
              <div className="bg-[#131315] border border-[#2b2a2c] rounded-lg shrink-0 p-4 shadow-sm">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#2b2a2c]/50">
                  <h3 className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-widest flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm text-[#facc15]" style={{ fontSize: '15px' }}>
                      tune
                    </span>
                    TRADE DETAILS & EXECUTION
                  </h3>
                  <div className="text-[10px] text-[#a1a1aa] flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#facc15]" />
                    Alpaca Paper Active
                  </div>
                </div>

                {/* Row 1: Symbol + Side + Quantity */}
                <div className="grid grid-cols-12 gap-3 mb-3">
                  <div className="col-span-4 space-y-1.5 relative" ref={symbolDropdownRef}>
                    <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider block">
                      Market / Symbol
                    </label>
                    
                    <button
                      type="button"
                      onClick={handleOpenSymbolDropdown}
                      className="w-full flex items-center justify-between bg-[#1c1b1d] border border-[#2b2a2c] hover:border-[#3f3f46] focus:border-[#facc15] rounded-md px-3 py-2 text-xs font-semibold text-[#e4e4e7] transition-all shadow-inner group cursor-pointer"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-sm font-bold text-[#facc15]">{selectedAsset.symbol}</span>
                        <span className="text-[10px] text-[#a1a1aa] font-medium truncate">{selectedAsset.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 pl-1">
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#0e0e10] border border-[#2b2a2c] text-[#a1a1aa]">
                          {selectedAsset.exchange.replace(/^ASSETEXCHANGE\./i, '').split('.').pop() || 'US'}
                        </span>
                        <svg className="w-3.5 h-3.5 text-[#a1a1aa] group-hover:text-[#e4e4e7] transition-transform" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </div>
                    </button>

                    {isSymbolDropdownOpen && (
                      <div className="absolute left-0 bottom-full mb-1.5 w-[340px] bg-[#18181b] border border-[#2b2a2c] rounded-lg shadow-2xl p-2.5 z-50">
                        <div className="relative mb-1.5">
                          <svg className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#a1a1aa]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                          </svg>
                          <input
                            type="text"
                            placeholder="Search 10,000+ Alpaca markets..."
                            value={symbolSearch}
                            onChange={(e) => setSymbolSearch(e.target.value)}
                            autoFocus
                            className="w-full bg-[#0e0e10] border border-[#2b2a2c] focus:border-[#facc15] rounded-md pl-8 pr-3 py-1.5 text-xs text-[#e4e4e7] placeholder-[#71717a] outline-none transition-colors"
                          />
                        </div>
                        <div className="flex items-center justify-between px-1 pb-1.5 text-[10px] text-[#71717a]">
                          <span>{filteredAssets.length.toLocaleString()} markets available</span>
                          <span className="text-[#10b981] font-mono text-[9px] flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                            Alpaca Live
                          </span>
                        </div>

                        <div className="h-[256px] relative">
                          {isLoadingAssets ? (
                            <div className="space-y-1">
                              {Array.from({ length: 5 }).map((_, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between p-2 rounded-md bg-[#1c1b1d]/50 animate-pulse border border-[#2b2a2c]/40"
                                >
                                  <div className="space-y-1.5">
                                    <div className="h-3 w-14 bg-[#2b2a2c] rounded" />
                                    <div className="h-2.5 w-24 bg-[#2b2a2c]/60 rounded" />
                                  </div>
                                  <div className="h-3.5 w-10 bg-[#2b2a2c] rounded" />
                                </div>
                              ))}
                            </div>
                          ) : filteredAssets.length === 0 ? (
                            <div className="text-center py-6 text-xs text-[#71717a]">
                              No Alpaca market found
                            </div>
                          ) : (
                            /* REQUIREMENT #2: Virtualized list loads items only in view and unloads others */
                            <VirtualSymbolList
                              assets={filteredAssets}
                              selectedSymbol={selectedAsset.symbol}
                              onSelect={async (asset) => {
                                setSelectedAsset(asset);
                                setAnalysisResult(null); // Clear previous stale analysis
                                const isCrypto = asset.asset_class === 'crypto' || asset.symbol.includes('/');
                                const p = Number(asset.price || 0);
                                if (p > 0) {
                                  setLimitPrice(p < 1 ? p.toFixed(4) : p.toFixed(2));
                                  const slPct = isCrypto ? 3.2 : 2.4;
                                  const tpPct = Number((slPct * 2.4).toFixed(1));
                                  const isBull = side === 'BUY';
                                  const slP = isBull ? p * (1 - slPct / 100) : p * (1 + slPct / 100);
                                  const tpP = isBull ? p * (1 + tpPct / 100) : p * (1 - tpPct / 100);
                                  setStopLoss(`${slPct}% ($${formatAssetPrice(slP)})`);
                                  setTakeProfit(`${tpPct}% ($${formatAssetPrice(tpP)})`);
                                }
                                setIsSymbolDropdownOpen(false);
                                setSymbolSearch('');

                                // Fetch 100% accurate real-time price and 24h change from Alpaca
                                try {
                                  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
                                  const encoded = encodeURIComponent(asset.symbol.replace('/', '-'));
                                  const priceRes = await fetch(`${backendUrl}/assets/price/${encoded}`);
                                  if (priceRes.ok) {
                                    const priceData = await priceRes.json();
                                    if (priceData.price && Number(priceData.price) > 0) {
                                      const liveP = Number(priceData.price);
                                      setSelectedAsset((prev) => ({
                                        ...prev,
                                        name: priceData.name || prev.name,
                                        price: liveP,
                                        change: priceData.change && priceData.change !== '0.00%' ? priceData.change : prev.change,
                                      }));
                                      setAllAssets((prev) =>
                                        prev.map((a) =>
                                          a.symbol === asset.symbol
                                            ? {
                                                ...a,
                                                name: priceData.name || a.name,
                                                price: liveP,
                                                change: priceData.change && priceData.change !== '0.00%' ? priceData.change : a.change,
                                              }
                                            : a
                                        )
                                      );
                                      setLimitPrice(liveP < 1 ? liveP.toFixed(4) : liveP.toFixed(2));
                                      const slPct = isCrypto ? 3.2 : 2.4;
                                      const tpPct = Number((slPct * 2.4).toFixed(1));
                                      const isBull = side === 'BUY';
                                      const slP = isBull ? liveP * (1 - slPct / 100) : liveP * (1 + slPct / 100);
                                      const tpP = isBull ? liveP * (1 + tpPct / 100) : liveP * (1 - tpPct / 100);
                                      setStopLoss(`${slPct}% ($${formatAssetPrice(slP)})`);
                                      setTakeProfit(`${tpPct}% ($${formatAssetPrice(tpP)})`);
                                    }
                                  }
                                } catch {
                                  // Keep initial asset price
                                }
                              }}
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Order Side */}
                  <div className="col-span-4 space-y-1.5">
                    <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider block">
                      Order Side
                    </label>
                    <div className="flex bg-[#1c1b1d] p-0.5 rounded-md border border-[#2b2a2c]">
                      <button
                        type="button"
                        onClick={() => {
                          setSide('BUY');
                          const curP = entryMode === 'LIMIT' && Number(limitPrice) > 0 ? Number(limitPrice) : Number(selectedAsset?.price || 0);
                          if (curP > 0) {
                            const isCrypto = selectedAsset.asset_class === 'crypto' || selectedAsset.symbol.includes('/');
                            const slPct = isCrypto ? 3.2 : 2.4;
                            const tpPct = Number((slPct * 2.4).toFixed(1));
                            const slP = curP * (1 - slPct / 100);
                            const tpP = curP * (1 + tpPct / 100);
                            setStopLoss(`${slPct}% ($${formatAssetPrice(slP)})`);
                            setTakeProfit(`${tpPct}% ($${formatAssetPrice(tpP)})`);
                          }
                        }}
                        className={`flex-1 py-1.5 text-xs font-bold rounded transition-all ${
                          side === 'BUY'
                            ? 'text-[#10b981] bg-[#10b981]/15 border border-[#10b981]/30 shadow-sm'
                            : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                        }`}
                      >
                        BUY / LONG
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSide('SELL');
                          const curP = entryMode === 'LIMIT' && Number(limitPrice) > 0 ? Number(limitPrice) : Number(selectedAsset?.price || 0);
                          if (curP > 0) {
                            const isCrypto = selectedAsset.asset_class === 'crypto' || selectedAsset.symbol.includes('/');
                            const slPct = isCrypto ? 3.2 : 2.4;
                            const tpPct = Number((slPct * 2.4).toFixed(1));
                            const slP = curP * (1 + slPct / 100);
                            const tpP = curP * (1 - tpPct / 100);
                            setStopLoss(`${slPct}% ($${formatAssetPrice(slP)})`);
                            setTakeProfit(`${tpPct}% ($${formatAssetPrice(tpP)})`);
                          }
                        }}
                        className={`flex-1 py-1.5 text-xs font-bold rounded transition-all ${
                          side === 'SELL'
                            ? 'text-[#ef4444] bg-[#ef4444]/15 border border-[#ef4444]/30 shadow-sm'
                            : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                        }`}
                      >
                        SELL / SHORT
                      </button>
                    </div>
                  </div>

                  {/* Quantity Input with Live Min/Max Auto-Correction & Decimal Conversion */}
                  {(() => {
                    // 1. Calculate symbol-specific minimum & maximum share limits
                    const isCrypto = selectedAsset.asset_class === 'crypto';
                    const minQty = isCrypto ? (selectedAsset.price > 1000 ? 0.0001 : 0.01) : 0.01;
                    const maxQty = Number((400000 / (selectedAsset.price || 1)).toFixed(isCrypto ? 4 : 2));
                    const stepValue = isCrypto ? (selectedAsset.price > 1000 ? 0.005 : 0.1) : 1;

                    // 2. Parse quantity safely as float for live conversion
                    const numericQuantity = parseFloat(String(quantity)) || 0;
                    const effectivePrice = entryMode === 'LIMIT' && Number(limitPrice) > 0 ? Number(limitPrice) : selectedAsset.price;
                    const estimatedDollarValue = numericQuantity > 0 ? numericQuantity * effectivePrice : 0;

                    // 3. Helper to enforce bounds
                    const clampToBounds = (val: number) => {
                      if (isNaN(val) || val < minQty) return minQty;
                      if (val > maxQty) return maxQty;
                      return Number(val.toFixed(isCrypto ? 4 : 2));
                    };

                    return (
                      <div className="col-span-4 space-y-1.5">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider">
                            Share Quantity
                          </label>
                          <span className="text-[9px] text-[#a1a1aa]/60 font-medium">
                            Min: {minQty} | Max: {maxQty.toLocaleString()}
                          </span>
                        </div>

                        <div className="flex items-center bg-[#1c1b1d] border border-[#2b2a2c] hover:border-[#3f3f46] focus-within:border-[#facc15] rounded-md px-1.5 py-1 transition-all shadow-inner">
                          {/* Stepper Decrement */}
                          <button
                            type="button"
                            onClick={() => {
                              const nextVal = clampToBounds(Number((numericQuantity - stepValue).toFixed(4)));
                              setQuantity(nextVal);
                            }}
                            className="w-6 h-6 flex items-center justify-center rounded bg-[#0e0e10] text-[#a1a1aa] hover:text-[#e4e4e7] hover:bg-[#27272a] transition-colors text-xs font-bold shrink-0 cursor-pointer"
                            title="Decrease"
                          >
                            -
                          </button>

                          {/* Live Bound-Detecting Decimal Input */}
                          <input
                            className="w-full bg-transparent border-none text-center text-xs font-semibold text-[#e4e4e7] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            type="number"
                            step="any"
                            min={minQty}
                            max={maxQty}
                            value={quantity}
                            placeholder={String(minQty)}
                            onChange={(e) => {
                              const val = e.target.value;

                              // Allow empty or intermediate decimal typing states so user can type "0.05"
                              if (val === '' || val === '0' || val === '0.' || val.endsWith('.')) {
                                setQuantity(val as any);
                                return;
                              }

                              const parsed = parseFloat(val);
                              if (!isNaN(parsed)) {
                                // DETECT IF PAST MAXIMUM: Automatically snap to max
                                if (parsed > maxQty) {
                                  setQuantity(maxQty);
                                  return;
                                }

                                // DETECT NEGATIVES: Automatically snap to min
                                if (parsed < 0) {
                                  setQuantity(minQty);
                                  return;
                                }

                                setQuantity(val as any);
                              }
                            }}
                            onBlur={() => {
                              // DETECT IF PAST MINIMUM OR MAXIMUM ON BLUR: Automatically clamp to bounds
                              const parsed = parseFloat(String(quantity));
                              setQuantity(clampToBounds(parsed));
                            }}
                            onKeyDown={(e) => {
                              // Pressing Enter confirms and auto-corrects immediately
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                          />

                          {/* Stepper Increment */}
                          <button
                            type="button"
                            onClick={() => {
                              const nextVal = clampToBounds(Number((numericQuantity + stepValue).toFixed(4)));
                              setQuantity(nextVal);
                            }}
                            className="w-6 h-6 flex items-center justify-center rounded bg-[#0e0e10] text-[#a1a1aa] hover:text-[#e4e4e7] hover:bg-[#27272a] transition-colors text-xs font-bold shrink-0 cursor-pointer"
                            title="Increase"
                          >
                            +
                          </button>

                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-[#0e0e10] border border-[#2b2a2c] text-[9px] font-bold text-[#a1a1aa] pointer-events-none shrink-0">
                            QTY
                          </span>
                        </div>

                        {/* Automatic Live Dollar Conversion Display */}
                        <div className="flex items-center justify-between px-0.5 text-[10px] pt-0.5">
                          <span className="text-[#a1a1aa]/70 font-medium">Est. Value:</span>
                          <span className="text-[#facc15] font-semibold tracking-tight">
                            ≈ ${estimatedDollarValue.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            <span className="text-[9px] text-[#a1a1aa] font-normal">USD</span>
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Row 2: Order Type & Entry Price */}
                <div className="grid grid-cols-12 gap-3 mb-3">
                  <div className="col-span-4 space-y-1.5 relative" ref={orderTypeDropdownRef}>
                    <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider block">
                      Execution Type
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsOrderTypeDropdownOpen(!isOrderTypeDropdownOpen)}
                      className={`w-full flex items-center justify-between bg-[#1c1b1d] border rounded-md px-3 py-2 text-xs font-semibold text-[#e4e4e7] transition-all shadow-inner cursor-pointer ${
                        isOrderTypeDropdownOpen
                          ? 'border-[#facc15]'
                          : 'border-[#2b2a2c] hover:border-[#3f3f46]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#facc15]" />
                        <span>{orderType} Order</span>
                      </div>
                      <svg
                        className={`w-3.5 h-3.5 text-[#a1a1aa] transition-transform duration-200 ${
                          isOrderTypeDropdownOpen ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>

                    {isOrderTypeDropdownOpen && (
                      <div className="absolute left-0 bottom-full mb-1.5 w-full bg-[#18181b] border border-[#2b2a2c] rounded-lg shadow-2xl p-1.5 z-50 space-y-1">
                        {[
                          { id: 'Market', label: 'Market Order', desc: 'Execute instantly at best price' },
                          { id: 'Limit', label: 'Limit Order', desc: 'Execute at set price or better' },
                          { id: 'Stop', label: 'Stop Loss Order', desc: 'Trigger market order on threshold' },
                          { id: 'Stop Limit', label: 'Stop Limit Order', desc: 'Trigger limit order on threshold' },
                        ].map((opt) => {
                          const isSelected = orderType === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                setOrderType(opt.id);
                                setIsOrderTypeDropdownOpen(false);
                              }}
                              className={`w-full flex flex-col text-left px-2.5 py-1.5 rounded-md transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-[#facc15]/10 border-l-2 border-[#facc15] text-[#facc15]'
                                  : 'text-[#e4e4e7] hover:bg-[#1c1b1d]'
                              }`}
                            >
                              <span className="text-xs font-bold">{opt.label}</span>
                              <span className="text-[10px] text-[#a1a1aa]">{opt.desc}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="col-span-8 space-y-1.5">
                    <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider block">
                      Entry Price Target
                    </label>
                    <div className="flex bg-[#1c1b1d] rounded-md border border-[#2b2a2c] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setEntryMode('MARKET')}
                        className={`px-4 py-1.5 text-xs font-bold transition-all ${
                          entryMode === 'MARKET' ? 'text-[#131315] bg-[#facc15]' : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                        }`}
                      >
                        MARKET
                      </button>
                      <button
                        type="button"
                        onClick={() => setEntryMode('LIMIT')}
                        className={`px-4 py-1.5 text-xs font-bold border-r border-[#2b2a2c]/50 transition-all ${
                          entryMode === 'LIMIT' ? 'text-[#131315] bg-[#facc15]' : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                        }`}
                      >
                        LIMIT
                      </button>
                      <div className="relative flex-1 flex items-center">
                        <span className="pl-3 text-xs text-[#a1a1aa] font-bold">$</span>
                        <input
                          className={`w-full bg-transparent border-none py-1.5 pl-1 pr-3 text-xs font-semibold text-[#e4e4e7] focus:outline-none text-right ${
                            entryMode === 'MARKET' ? 'opacity-40 cursor-not-allowed' : 'cursor-text'
                          }`}
                          disabled={entryMode === 'MARKET'}
                          placeholder="0.00"
                          type="text"
                          value={entryMode === 'MARKET' ? (selectedAsset?.price != null ? (selectedAsset.price < 1 ? selectedAsset.price.toFixed(4) : selectedAsset.price.toFixed(2)) : '') : limitPrice}
                          onChange={(e) => setLimitPrice(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Row 3: Stop Loss & Take Profit */}
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider">
                        Guardian Stop Loss
                      </label>
                      <span className="text-[9px] text-[#ef4444] font-semibold">Risk Protection</span>
                    </div>
                    <input
                      className="w-full bg-[#1c1b1d] border border-[#2b2a2c] focus:border-[#facc15] rounded-md py-1.5 px-3 text-xs text-[#e4e4e7] focus:outline-none transition-colors"
                      placeholder="e.g. 5% or $215.00"
                      type="text"
                      value={stopLoss}
                      onChange={(e) => setStopLoss(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider">
                        Guardian Take Profit
                      </label>
                      <span className="text-[9px] text-[#10b981] font-semibold">Target Yield</span>
                    </div>
                    <input
                      className="w-full bg-[#1c1b1d] border border-[#2b2a2c] focus:border-[#facc15] rounded-md py-1.5 px-3 text-xs text-[#e4e4e7] focus:outline-none transition-colors"
                      placeholder="e.g. 10% or $250.00"
                      type="text"
                      value={takeProfit}
                      onChange={(e) => setTakeProfit(e.target.value)}
                    />
                  </div>
                </div>

                {/* Row 4: Actions */}
                <div className="flex items-center justify-between border-t border-[#2b2a2c]/50 pt-3">
                  <button
                    type="button"
                    className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[#a1a1aa] hover:text-[#e4e4e7] hover:bg-[#1c1b1d] transition-colors text-xs font-medium"
                  >
                    <svg fill="none" height="14" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="14">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                    Risk Parameters
                  </button>

                  <button
                    type="button"
                    onClick={handleAnalyzeTrade}
                    disabled={isAnalyzing}
                    className="flex items-center gap-2 bg-[#facc15] text-[#131315] font-bold text-xs px-6 py-2 rounded-md hover:bg-[#facc15]/90 transition-all disabled:opacity-50 cursor-pointer shadow-sm active:scale-[0.98]"
                  >
                    {isAnalyzing ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5 text-[#131315]" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        ANALYZING RISK...
                      </>
                    ) : (
                      <>
                        ANALYZE TRADE
                        <svg fill="none" height="13" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" width="13">
                          <path d="M5 12h14" />
                          <path d="m12 5 7 7-7 7" />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Middle Panel Footer */}
              <div className="flex items-center justify-between text-[10px] text-[#a1a1aa]/60 shrink-0 px-1">
                <span>All trades are verified through TradeGuardian Alpaca risk filters.</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                  Alpaca Markets Real-Time
                </div>
              </div>
            </main>

            {/* Right Side Risk Panel - Premium Styled Matching Left Sidebar */}
            <aside
              className="w-full lg:w-[380px] lg:shrink-0 border-t lg:border-t-0 lg:border-l border-[#2b2a2c] bg-[#131315] flex flex-col custom-scrollbar shadow-2xl rounded-xl lg:rounded-none overflow-hidden"
            >
              {/* Brand / Risk Desk Header matching Left Sidebar */}
              <div className="p-4 flex items-center justify-between border-b border-[#2b2a2c]/50 shrink-0 bg-[#131315]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#facc15]/10 border border-[#facc15]/30 flex items-center justify-center text-[#facc15] shadow-inner">
                    <span className="material-symbols-outlined text-lg" style={{ fontSize: '19px' }}>
                      verified_user
                    </span>
                  </div>
                  <div>
                    <div className="font-bold text-sm text-[#e4e4e7] flex items-center gap-1.5">
                      Guardian Risk Desk
                    </div>
                    <div className="text-[10px] text-[#a1a1aa]">Autonomous Policy Audit</div>
                  </div>
                </div>

                <span
                  className={`text-[9px] font-bold px-2.5 py-0.5 rounded-full border transition-all ${
                    analysisResult
                      ? analysisResult.decision.status === 'APPROVED'
                        ? 'text-[#10b981] border-[#10b981]/40 bg-[#10b981]/15 shadow-sm shadow-[#10b981]/20'
                        : 'text-red-400 border-red-500/40 bg-red-500/15 shadow-sm shadow-red-500/20'
                      : 'text-[#a1a1aa] border-[#2b2a2c] bg-[#1c1b1d]'
                  }`}
                >
                  {analysisResult ? analysisResult.decision.status : 'STANDBY'}
                </span>
              </div>

              {/* Scrollable Risk Body */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
                {!analysisResult ? (
                  // STANDBY STATE (Elegant empty state matching left sidebar aesthetic)
                  <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8 space-y-4">
                    <div className="w-16 h-16 rounded-full bg-[#1c1b1d] border border-[#2b2a2c] flex items-center justify-center text-[#facc15] relative shadow-inner">
                      {isExecutingTrade ? (
                        <div className="animate-spin text-2xl text-[#facc15]">↻</div>
                      ) : (
                        <>
                          <div className="absolute inset-0 rounded-full bg-[#facc15]/5 animate-ping" />
                          <span className="material-symbols-outlined text-2xl" style={{ fontSize: '28px' }}>
                            shield
                          </span>
                        </>
                      )}
                    </div>

                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-[#e4e4e7]">
                        {isExecutingTrade ? 'Routing Order to Alpaca MCP...' : 'Ready for Pre-Trade Audit'}
                      </h4>
                      <p className="text-xs text-[#a1a1aa] leading-relaxed max-w-[280px]">
                        {isExecutingTrade
                          ? 'Submitting trade through Alpaca FastMCP server and synchronizing portfolio ledger.'
                          : (
                            <>
                              Specify order quantity and click <span className="text-[#facc15] font-semibold">Analyze Trade</span> to run multi-agent risk verification before routing to Alpaca.
                            </>
                          )}
                      </p>
                    </div>

                    {tradeExecutionMessage && (
                      <div
                        className={`p-2.5 rounded-lg border text-xs max-w-[280px] text-center font-medium animate-in fade-in duration-200 ${
                          tradeExecutionSuccess
                            ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                            : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1.5 font-bold mb-0.5">
                          <span className="material-symbols-outlined text-sm">
                            {tradeExecutionSuccess ? 'check_circle' : 'error'}
                          </span>
                          <span>{tradeExecutionSuccess ? 'Order Submitted' : 'Execution Notice'}</span>
                        </div>
                        <p className="text-[11px] text-[#d4d4d8] leading-tight">{tradeExecutionMessage}</p>
                      </div>
                    )}

                    {errorMessage && (
                      <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 max-w-[280px]">
                        {errorMessage}
                      </div>
                    )}

                    {/* Pre-flight Active Guardrails Summary */}
                    <div className="w-full bg-[#18181b] border border-[#2b2a2c]/60 rounded-lg p-3 text-left space-y-2.5 mt-2">
                      <div className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-widest flex items-center justify-between">
                        <span>Active Guardrails</span>
                        <span className="text-[#10b981] font-semibold text-[9px]">4/4 Enforced</span>
                      </div>
                      <div className="space-y-1.5 text-[11px] text-[#a1a1aa]">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                          <span>Solvency & Buying Power Check</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                          <span>Max 10% Single-Trade Exposure Limit</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                          <span>Max 25% Asset Concentration Ceiling</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                          <span>Adversarial Devil’s Advocate Review</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  // EVALUATED STATE (Premium Glass Card Layout)
                  <div className="space-y-4 animate-fadeIn">
                    {/* Hero Guardian Decision Banner */}
                    <div
                      className={`rounded-lg p-4 border transition-all relative overflow-hidden shadow-lg ${
                        analysisResult.decision.status === 'APPROVED'
                          ? 'bg-gradient-to-b from-emerald-950/40 via-[#18181b] to-[#131315] border-emerald-500/50 shadow-emerald-950/20'
                          : 'bg-gradient-to-b from-rose-950/40 via-[#18181b] to-[#131315] border-rose-500/50 shadow-rose-950/20'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-10 h-10 rounded-lg border flex items-center justify-center shrink-0 ${
                            analysisResult.decision.status === 'APPROVED'
                              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                              : 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                          }`}
                        >
                          <span className="material-symbols-outlined text-xl" style={{ fontSize: '22px' }}>
                            {analysisResult.decision.status === 'APPROVED' ? 'verified' : 'gpp_bad'}
                          </span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-[#e4e4e7]">
                              {analysisResult.decision.status === 'APPROVED' ? 'Order Approved' : 'Order Blocked'}
                            </span>
                            <span
                              className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded ${
                                analysisResult.decision.status === 'APPROVED'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : 'bg-rose-500/20 text-rose-400'
                              }`}
                            >
                              {analysisResult.decision.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#a1a1aa] mt-1 leading-relaxed">
                            {analysisResult.decision.status === 'APPROVED'
                              ? 'Trade passed all safety criteria and complies with capital protection guidelines.'
                              : 'Trade exceeds risk tolerances or violates one of the Guardian risk guardrails.'}
                          </p>
                        </div>
                      </div>

                      {/* Decision Reasons */}
                      {analysisResult.decision?.reasons && analysisResult.decision.reasons.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-[#2b2a2c]/60 space-y-1">
                          {analysisResult.decision.reasons.map((r, i) => (
                            <div key={i} className="text-[10px] text-[#d4d4d8] flex items-start gap-1.5">
                              <span className="text-[#facc15] font-bold">›</span>
                              <span>{r}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Guardian Safe Sizing Suggestion Banner */}
                      {analysisResult.decision?.status !== 'APPROVED' &&
                       analysisResult.proposal?.suggested_safe_quantity &&
                       analysisResult.proposal.suggested_safe_quantity > 0 &&
                       analysisResult.proposal.suggested_safe_quantity !== Number(quantity) && (
                        <div className="mt-3 p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 animate-in fade-in duration-300">
                          <div className="flex items-center gap-2">
                            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                            <div className="text-[11px] font-medium text-emerald-300">
                              Guardian Safe Sizing: <strong className="text-white font-bold">{analysisResult.proposal.suggested_safe_quantity} {analysisResult.proposal.symbol}</strong> (≤4.5% exposure)
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const safeQty = analysisResult.proposal.suggested_safe_quantity!;
                              setQuantity(safeQty);
                              handleAnalyzeTrade(safeQty);
                            }}
                            className="w-full sm:w-auto px-2.5 py-1 text-[11px] font-bold text-emerald-900 bg-emerald-400 hover:bg-emerald-300 active:scale-95 transition-all rounded shadow-sm flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Apply Safe Size & Re-Audit
                          </button>
                        </div>
                      )}


                    </div>

                    {/* Capital Impact & Exposure (Styled like Sidebar Account Section) */}
                    <div className="space-y-2">
                      <div className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-widest px-1">
                        CAPITAL IMPACT & METRICS
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-3 bg-[#18181b] border border-[#2b2a2c]/70 rounded-lg">
                          <div className="text-[10px] text-[#a1a1aa] uppercase tracking-wider">Trade Nominal Value</div>
                          <div className="text-base font-bold text-[#e4e4e7] mt-0.5">
                            ${Number(analysisResult?.proposal?.trade_value ?? 0).toLocaleString()}
                          </div>
                          <div className="text-[10px] text-[#a1a1aa]/80 mt-0.5">
                            {analysisResult?.proposal?.quantity} {analysisResult?.proposal?.symbol} @ ${formatAssetPrice(analysisResult?.proposal?.current_price)}
                          </div>
                        </div>

                        <div className="p-3 bg-[#18181b] border border-[#2b2a2c]/70 rounded-lg">
                          <div className="text-[10px] text-[#a1a1aa] uppercase tracking-wider">Equity Exposure</div>
                          <div className="text-base font-bold text-[#facc15] mt-0.5 flex items-baseline gap-1">
                            <span>{analysisResult?.risk_metrics?.trade_percent_of_equity}%</span>
                            <span className="text-[10px] text-[#a1a1aa] font-normal">/ 10% limit</span>
                          </div>
                          {/* Exposure mini gauge */}
                          <div className="w-full bg-[#27272a] h-1.5 rounded-full overflow-hidden mt-1.5">
                            <div
                              className={`h-full rounded-full transition-all ${
                                (analysisResult?.risk_metrics?.trade_percent_of_equity || 0) <= 10
                                  ? 'bg-[#10b981]'
                                  : 'bg-rose-500'
                              }`}
                              style={{
                                width: `${Math.min(
                                  ((analysisResult?.risk_metrics?.trade_percent_of_equity || 0) / 10) * 100,
                                  100
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="p-2.5 bg-[#18181b] border border-[#2b2a2c]/60 rounded-lg flex items-center justify-between text-xs">
                        <span className="text-[10px] text-[#a1a1aa] uppercase font-bold tracking-wider">
                          Remaining Buying Power
                        </span>
                        <span className="font-bold text-[#e4e4e7]">
                          ${Math.max(
                            0,
                            (analysisResult?.risk_metrics?.buying_power || 0) -
                              (analysisResult?.proposal?.trade_value || 0)
                          ).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {/* Policy Enforcement Audit (Matching Nav List Item Design) */}
                    <div className="space-y-2">
                      <div className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-widest px-1">
                        GUARDIAN POLICY AUDIT (4 CHECKS)
                      </div>

                      <div className="space-y-1.5">
                        {[
                          {
                            title: 'Buying Power Check',
                            subtitle: 'Solvency & margin requirement',
                            check: analysisResult.risk_checks.buying_power,
                            icon: 'payments',
                          },
                          {
                            title: 'Trade Exposure (≤10%)',
                            subtitle: 'Single-order capital allocation',
                            check: analysisResult.risk_checks.exposure,
                            icon: 'pie_chart',
                          },
                          {
                            title: 'Concentration Limit (≤25%)',
                            subtitle: 'Portfolio diversification buffer',
                            check: analysisResult.risk_checks.concentration,
                            icon: 'hub',
                          },
                          {
                            title: 'Position Validation',
                            subtitle: 'Exchange symbol & order validity',
                            check: analysisResult.risk_checks.position,
                            icon: 'rule',
                          },
                        ].map((item, idx) => (
                          <div
                            key={idx}
                            className="p-3 bg-[#18181b] border border-[#2b2a2c]/60 hover:border-[#3f3f46] rounded-lg transition-all space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`material-symbols-outlined text-sm ${
                                    item.check.status === 'PASS' ? 'text-[#10b981]' : 'text-rose-400'
                                  }`}
                                  style={{ fontSize: '16px' }}
                                >
                                  {item.check.status === 'PASS' ? 'check_circle' : 'cancel'}
                                </span>
                                <span className="font-bold text-[#e4e4e7] text-xs">{item.title}</span>
                              </div>
                              <span
                                className={`text-[8px] font-extrabold uppercase px-2 py-0.5 rounded ${
                                  item.check.status === 'PASS'
                                    ? 'bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30'
                                    : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                }`}
                              >
                                {item.check.status === 'PASS' ? 'PASSED' : 'FAILED'}
                              </span>
                            </div>
                            <div className="text-[10px] text-[#a1a1aa] pl-6 leading-relaxed">
                              {item.check.reason}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Committee Certification Footer */}
                    <div className="p-3 rounded-lg bg-[#141416] border border-[#2b2a2c]/50 text-[10px] text-[#a1a1aa] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                        <span>Adversarial Stress Test: Cleared</span>
                      </div>
                      <span className="text-[#facc15] font-semibold uppercase tracking-wider text-[9px]">
                        TradeGuardian AI
                      </span>
                    </div>

                    {/* View Multi-Agent Deliberation Chamber */}
                    <button
                      type="button"
                      onClick={() => setIsDeliberationModalOpen(true)}
                      className="w-full py-2 px-3 rounded-md bg-[#1c1b1d] hover:bg-[#27272a] border border-[#2b2a2c] hover:border-[#facc15] text-xs font-bold text-[#e4e4e7] flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
                    >
                      <span className="material-symbols-outlined text-sm text-[#facc15]">forum</span>
                      <span>Inspect Agent Swarm Deliberation</span>
                    </button>

                    {/* Alpaca MCP Execution Trigger */}
                    {analysisResult.decision.status === 'APPROVED' && (
                      <div className="p-3 bg-[#18181b] border border-[#10b981]/40 rounded-lg space-y-2.5 mt-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[#10b981] font-bold flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-sm">verified</span>
                            Guardian Pre-Trade Clearance
                          </span>
                          <span className="text-[10px] text-[#facc15] font-semibold">Alpaca FastMCP</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleExecuteTradeViaMcp}
                          disabled={isExecutingTrade || tradeExecutionSuccess}
                          className={`w-full py-2.5 rounded-md font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all ${
                            tradeExecutionSuccess
                              ? 'bg-[#10b981] text-white cursor-default'
                              : 'bg-[#facc15] hover:bg-[#eab308] text-[#131315] shadow-lg shadow-[#facc15]/20 active:scale-[0.99]'
                          }`}
                        >
                          {isExecutingTrade ? (
                            <>
                              <span className="animate-spin text-sm">↻</span>
                              <span>Routing to Alpaca MCP...</span>
                            </>
                          ) : tradeExecutionSuccess ? (
                            <>
                              <span className="material-symbols-outlined text-sm">check_circle</span>
                              <span>Order Placed (Alpaca FastMCP)</span>
                            </>
                          ) : (
                            <>
                              <span className="material-symbols-outlined text-sm">bolt</span>
                              <span>Execute Order (Alpaca MCP Server)</span>
                            </>
                          )}
                        </button>
                        {tradeExecutionMessage && (
                          <div className="text-[10px] text-center text-[#a1a1aa] bg-[#131315] p-2 rounded border border-[#2b2a2c]">
                            {tradeExecutionMessage}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      </div>

      {/* Dashboard Landing View */}
      <div className={`flex flex-1 overflow-hidden h-full ${currentView === 'dashboard' ? 'flex' : 'hidden'}`}>
        <DashboardPage
          onNavigate={(tab: 'dashboard' | 'analysis' | 'ai_opportunity' | 'positions' | 'settings') => setCurrentView(tab)}
          isActive={currentView === 'dashboard'}
          onSelectTrade={(symbol: string, bias?: 'BUY' | 'SELL') => {
            setAnalysisResult(null);
            const found = allAssets.find((a) => a.symbol === symbol);
            if (found) {
              setSelectedAsset(found);
              const p = Number(found.price || 0);
              setLimitPrice(p > 0 ? (p < 1 ? p.toFixed(4) : p.toFixed(2)) : '0.00');
              const isCrypto = found.asset_class === 'crypto' || found.symbol.includes('/');
              const slPct = isCrypto ? 3.2 : 2.4;
              const tpPct = Number((slPct * 2.4).toFixed(1));
              const isBull = (bias || 'BUY') === 'BUY';
              const slP = isBull ? p * (1 - slPct / 100) : p * (1 + slPct / 100);
              const tpP = isBull ? p * (1 + tpPct / 100) : p * (1 - tpPct / 100);
              setStopLoss(`${slPct}% ($${formatAssetPrice(slP)})`);
              setTakeProfit(`${tpPct}% ($${formatAssetPrice(tpP)})`);
            } else {
              setSelectedAsset({
                symbol,
                name: symbol,
                exchange: 'NASDAQ',
                asset_class: 'us_equity',
                price: 0,
                change: '0.00%',
              });
            }
            if (bias) setSide(bias);
            setCurrentView('analysis');
          }}
          onSelectProposedTrade={(proposed: ProposedTradeDetails) => {
            // Reset Guardian Risk Desk back to default waiting state
            setAnalysisResult(null);

            // 1. Locate asset or set metadata
            const found = allAssets.find((a) => a.symbol === proposed.symbol);
            if (found) {
              setSelectedAsset(found);
            } else {
              setSelectedAsset({
                symbol: proposed.symbol,
                name: proposed.symbol,
                exchange: 'NASDAQ',
                asset_class: 'us_equity',
                price: parseFloat(proposed.entryPrice) || 0,
                change: '0.00%',
              });
            }

            // 2. Update Order Side
            setSide(proposed.orderSide);

            // 3. Update Share Quantity
            setQuantity(proposed.quantity);

            // 4. Update Execution Type
            setOrderType(proposed.executionType);

            // 5. Update Entry Price Target and Entry Mode
            if (proposed.executionType === 'Market') {
              setEntryMode('MARKET');
              setLimitPrice(proposed.entryPrice);
            } else {
              setEntryMode('LIMIT');
              setLimitPrice(proposed.entryPrice);
            }

            // 6. Update Guardian Stop Loss
            setStopLoss(proposed.guardianSL);

            // 7. Update Guardian Take Profit
            setTakeProfit(proposed.guardianTP);

            // 8. Inform user with clean pre-fill banner
            setTradeExecutionSuccess(false);
            setTradeExecutionMessage(`AI Opportunity Pre-filled: ${proposed.symbol} ${proposed.orderSide} ${proposed.quantity} shares @ $${proposed.entryPrice} (${proposed.executionType}). Review Guardian checks and submit order.`);

            // 9. Navigate to Trade Analysis desk
            setCurrentView('analysis');
          }}
        />
      </div>

      {/* REQUIREMENT #1: AI Opportunities View (persisted, hidden when analysis is active, analyzes only ONCE on open) */}
      <div className={`flex flex-1 overflow-hidden h-full ${currentView === 'ai_opportunity' ? 'flex' : 'hidden'}`}>
        <AIOpportunity
          onNavigate={(tab) => setCurrentView(tab)}
          isActive={currentView === 'ai_opportunity'}
          onSelectTrade={(opp) => {
            const found = allAssets.find((a) => a.symbol === opp.symbol || a.symbol === opp.symbol.replace('/', '') || a.symbol.replace('/', '') === opp.symbol.replace('/', ''));
            if (found) {
              setSelectedAsset({
                ...found,
                price: opp.currentPrice || found.price,
              });
            } else {
              setSelectedAsset({
                symbol: opp.symbol,
                name: opp.name || opp.symbol,
                exchange: opp.isCrypto ? 'CRYPTO' : 'NASDAQ',
                asset_class: opp.isCrypto ? 'crypto' : 'us_equity',
                tradable: true,
                price: opp.currentPrice || 0,
                change: '0.00%',
              });
            }
            if (opp.proposedTrade) {
              const cleanSide = opp.proposedTrade.orderSide.toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
              setSide(cleanSide);
              setQuantity(opp.proposedTrade.quantity);
              setOrderType(opp.proposedTrade.executionType);
              if (opp.proposedTrade.executionType === 'Market') {
                setEntryMode('MARKET');
              } else {
                setEntryMode('LIMIT');
              }
              setLimitPrice(opp.proposedTrade.entryPrice);
              setStopLoss(opp.proposedTrade.guardianSL);
              setTakeProfit(opp.proposedTrade.guardianTP);
              setTradeExecutionSuccess(false);
              setTradeExecutionMessage(`AI Opportunity Pre-filled: ${opp.proposedTrade.symbol} ${cleanSide} ${opp.proposedTrade.quantity} @ $${opp.proposedTrade.entryPrice} (${opp.proposedTrade.executionType}). Review Guardian checks and submit order.`);
            } else {
              setSide(opp.bias === 'Bearish' ? 'SELL' : 'BUY');
              if (opp.currentPrice) {
                const p = Number(opp.currentPrice);
                setLimitPrice(p < 1 ? p.toFixed(4) : p.toFixed(2));
              } else if (found?.price) {
                const p = Number(found.price);
                setLimitPrice(p < 1 ? p.toFixed(4) : p.toFixed(2));
              }
              if (opp.stopLoss) setStopLoss(opp.stopLoss);
              if (opp.takeProfit) setTakeProfit(opp.takeProfit);
            }

            // Requirement 2: when the user presses trade analyze in an ai opportunity card,
            // the guardian risk desk should go back to its default waiting state if it wasn't default.
            setAnalysisResult(null);

            setCurrentView('analysis');
          }}
        />
      </div>

      {/* REQUIREMENT: Position Manager & P&L View */}
      <div className={`flex flex-1 overflow-hidden h-full ${currentView === 'positions' ? 'flex' : 'hidden'}`}>
        <PositionsManagerPage onNavigate={(tab) => setCurrentView(tab)} isActive={currentView === 'positions'} />
      </div>

      {/* Settings View */}
      <div className={`flex flex-1 overflow-hidden h-full ${currentView === 'settings' ? 'flex' : 'hidden'}`}>
        <SettingsPage
          onNavigate={(tab) => setCurrentView(tab)}
          isActive={currentView === 'settings'}
        />
      </div>

      {/* Alpaca Official CLI Modal */}
      <AlpacaCliModal isOpen={isCliModalOpen} onClose={() => setIsCliModalOpen(false)} />

      {/* Multi-Agent Deliberation Chamber Modal */}
      <AgentDeliberationModal
        isOpen={isDeliberationModalOpen}
        symbol={selectedAsset.symbol}
        onClose={() => setIsDeliberationModalOpen(false)}
      />
    </div>
  );
}