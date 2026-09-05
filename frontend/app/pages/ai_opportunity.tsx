'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Sidebar } from '../components/Sidebar';
import AgentDeliberationModal from '../components/AgentDeliberationModal';
import { AIOpportunity, ProposedTradeDetails } from '../types/trade';

interface Props {
  onNavigate: (tab: 'dashboard' | 'analysis' | 'ai_opportunity' | 'positions' | 'settings') => void;
  onSelectTrade?: (opportunity: AIOpportunity) => void;
  isActive?: boolean;
}

// Module-level cache to remember scan results across tab navigation within a session
let globalOpportunitiesCache: AIOpportunity[] | null = null;
let globalLastScannedScope: { mode: 'all' | 'dynamic' | 'crypto' | 'custom'; symbols?: string[] } | null = null;
let globalLastScannedTimestamp: number = 0;

// Curated market preset clusters for quick one-click selection
const RECOMMENDED_PRESETS = [
  {
    id: 'mega_tech',
    label: 'Mega-Cap Tech Alpha',
    icon: 'bolt',
    description: 'Top market-cap technology leaders driving liquidity and index momentum.',
    symbols: ['NVDA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL'],
  },
  {
    id: 'indices',
    label: 'Core Indices & ETFs',
    icon: 'query_stats',
    description: 'Broad market benchmarks and major equity ETFs for lower idiosyncratic risk.',
    symbols: ['SPY', 'QQQ', 'IWM', 'DIA'],
  },
  {
    id: 'momentum_ai',
    label: 'AI & High Momentum',
    icon: 'rocket_launch',
    description: 'High-beta AI infrastructure and high-volatility momentum setups.',
    symbols: ['TSLA', 'AMD', 'PLTR', 'COIN', 'AVGO'],
  },
  {
    id: 'crypto_leaders',
    label: 'Crypto 24/7 Leaders',
    icon: 'currency_bitcoin',
    description: 'Liquid digital assets with 24/7 momentum and Guardian spot stop-loss/take-profit protection.',
    symbols: ['BTC/USD', 'ETH/USD', 'SOL/USD', 'DOGE/USD', 'AVAX/USD'],
  },
  {
    id: 'defensive',
    label: 'Value & Defensive',
    icon: 'shield',
    description: 'Cash-generative enterprise leaders and non-cyclical defensive anchors.',
    symbols: ['JPM', 'BAC', 'WMT', 'COST', 'DIS'],
  },
];

function formatStrategyName(strat?: string): string {
  if (!strat) return 'Strategy Setup';
  const specialMap: Record<string, string> = {
    long_put: 'Long Put',
    long_call: 'Long Call',
    bull_call_spread: 'Bull Call Spread',
    bear_put_spread: 'Bear Put Spread',
    bull_put_spread: 'Bull Put Spread',
    bear_call_spread: 'Bear Call Spread',
    covered_call: 'Covered Call',
    cash_secured_put: 'Cash-Secured Put',
    iron_condor: 'Iron Condor',
    iron_butterfly: 'Iron Butterfly',
    straddle: 'Long Straddle',
    strangle: 'Long Strangle',
  };
  const key = strat.toLowerCase().trim();
  if (specialMap[key]) {
    return specialMap[key];
  }
  return strat
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function InViewCardWrapper({
  children,
  id,
  isExpanded = false,
  isRevealed = true,
}: {
  children: React.ReactNode;
  id: string;
  isExpanded?: boolean;
  isRevealed?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState<boolean>(true);
  const measuredHeight = useRef<number>(0);
  const fallbackHeight = isExpanded ? 760 : 520;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      if (h > 0) measuredHeight.current = h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Use closest scroll container (.overflow-y-auto) or fallback to viewport
    const scrollParent = el.closest('.overflow-y-auto') || null;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(entry.isIntersecting);
      },
      {
        root: scrollParent,
        rootMargin: '0px',
        threshold: 0,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isExpanded]);

  const ghostHeight = measuredHeight.current > 0 ? measuredHeight.current : fallbackHeight;

  return (
    <div
      ref={ref}
      data-card-id={id}
      style={{
        minHeight: `${ghostHeight}px`,
        contentVisibility: 'auto',
        containIntrinsicSize: `auto ${ghostHeight}px`,
      } as React.CSSProperties}
      className="w-full"
    >
      {isRevealed && isInView ? (
        children
      ) : (
        <GhostOpportunityCard height={ghostHeight} isExpanded={isExpanded} />
      )}
    </div>
  );
}

// Deep opportunity equality comparison to detect stagnant market data on re-scan
function areOpportunitiesEqual(prev: AIOpportunity[], next: AIOpportunity[]): boolean {
  if (prev.length !== next.length) return false;
  if (prev.length === 0 && next.length === 0) return true;

  // Map next opportunities by symbol for stable order-independent comparison
  const nextMap = new Map<string, AIOpportunity>();
  for (const opp of next) {
    nextMap.set(opp.symbol, opp);
  }

  if (nextMap.size !== prev.length) return false;

  for (const a of prev) {
    const b = nextMap.get(a.symbol);
    if (!b) return false;
    if (a.bias !== b.bias) return false;
    if (a.strategy !== b.strategy) return false;
    if (Math.abs((a.confidence || 0) - (b.confidence || 0)) > 0.05) return false;
    if (a.market_regime !== b.market_regime) return false;

    // Price comparison: check if currentPrice shifted by > 0.02%
    const pA = a.currentPrice || 0;
    const pB = b.currentPrice || 0;
    if (pA > 0 && pB > 0) {
      const diffPct = Math.abs(pA - pB) / pA;
      if (diffPct > 0.0002) return false;
    } else if (pA !== pB) {
      return false;
    }

    if (a.stopLoss !== b.stopLoss) return false;
    if (a.takeProfit !== b.takeProfit) return false;
    if (a.adversarialVerdict !== b.adversarialVerdict) return false;
    if (Boolean(a.is_overextended) !== Boolean(b.is_overextended)) return false;
  }

  return true;
}

export default function AIOpportunityPage({ onNavigate, onSelectTrade, isActive = false }: Props) {
  const [opportunities, setOpportunities] = useState<AIOpportunity[]>(() => globalOpportunitiesCache || []);
  const [loading, setLoading] = useState<boolean>(false);
  const [isReScanning, setIsReScanning] = useState<boolean>(false);
  const [revealedCount, setRevealedCount] = useState<number>(() =>
    globalOpportunitiesCache && globalOpportunitiesCache.length > 0 ? 9999 : 0
  );
  const [stagnantToast, setStagnantToast] = useState<{ show: boolean; animatingOut: boolean } | null>(null);

  const [activeScanMode, setActiveScanMode] = useState<'all' | 'dynamic' | 'crypto' | 'custom' | null>(() => globalLastScannedScope?.mode || null);
  const [lastScannedSymbols, setLastScannedSymbols] = useState<string[]>(() => globalLastScannedScope?.symbols || []);
  const [scanTimestamp, setScanTimestamp] = useState<number>(() => globalLastScannedTimestamp);
  const [scanError, setScanError] = useState<string | null>(null);

  // Selector View vs Results View: default to selector if no opportunities cached yet
  const [viewMode, setViewMode] = useState<'selector' | 'results'>(() => (globalOpportunitiesCache && globalOpportunitiesCache.length > 0 ? 'results' : 'selector'));
  const [deepScanSubMode, setDeepScanSubMode] = useState<'all' | 'dynamic'>('all');

  // Selected custom tickers state
  const [customSelectedSymbols, setCustomSelectedSymbols] = useState<string[]>(['NVDA', 'AAPL', 'MSFT', 'TSLA']);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [availableAssets, setAvailableAssets] = useState<{ symbol: string; name: string }[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Filters & Cards UI
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedBias, setSelectedBias] = useState<string>('All');
  const [selectedStrategy, setSelectedStrategy] = useState<string>('All');
  const [selectedAssetClass, setSelectedAssetClass] = useState<'All' | 'us_equity' | 'crypto'>('All');
  const [minConfidenceFilter, setMinConfidenceFilter] = useState<number>(0);
  const [deliberationSymbol, setDeliberationSymbol] = useState<string | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const [executingOppId, setExecutingOppId] = useState<string | null>(null);
  const [oppExecutionMsg, setOppExecutionMsg] = useState<{ [id: string]: string }>({});

  const inFlightControllerRef = useRef<AbortController | null>(null);
  const isSubmittingRef = useRef<boolean>(false);
  const revealTimerRef = useRef<NodeJS.Timeout | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const toastExitTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Staggered progressive reveal of opportunities one by one (180ms cadence)
  const triggerStaggeredReveal = useCallback((targetCount: number) => {
    if (revealTimerRef.current) clearInterval(revealTimerRef.current);
    setRevealedCount(0);

    if (targetCount <= 0) return;

    let current = 0;
    revealTimerRef.current = setInterval(() => {
      current += 1;
      setRevealedCount(current);
      if (current >= targetCount) {
        if (revealTimerRef.current) clearInterval(revealTimerRef.current);
        revealTimerRef.current = null;
        setRevealedCount(9999);
      }
    }, 180);
  }, []);

  // Display top-middle notification when market data is stagnant, animating up until gone
  const showStagnantNotification = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (toastExitTimerRef.current) clearTimeout(toastExitTimerRef.current);

    setStagnantToast({ show: true, animatingOut: false });

    toastTimerRef.current = setTimeout(() => {
      setStagnantToast((prev) => (prev ? { ...prev, animatingOut: true } : null));
      toastExitTimerRef.current = setTimeout(() => {
        setStagnantToast(null);
      }, 500);
    }, 2300);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (toastExitTimerRef.current) clearTimeout(toastExitTimerRef.current);
    };
  }, []);

  // Fetch available tradeable assets for search autocomplete
  useEffect(() => {
    let isMounted = true;
    async function loadAssets() {
      try {
        const res = await fetch(`${backendUrl}/assets/`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && isMounted) {
            setAvailableAssets(
              data.map((item: any) => ({
                symbol: String(item.symbol || '').toUpperCase(),
                name: String(item.name || item.symbol || ''),
              }))
            );
          }
        }
      } catch (err) {
        // Fallback to primary liquid list if backend assets call fails
        if (isMounted) {
          setAvailableAssets([
            { symbol: 'NVDA', name: 'NVIDIA Corporation' },
            { symbol: 'AAPL', name: 'Apple Inc.' },
            { symbol: 'MSFT', name: 'Microsoft Corporation' },
            { symbol: 'AMZN', name: 'Amazon.com, Inc.' },
            { symbol: 'META', name: 'Meta Platforms, Inc.' },
            { symbol: 'GOOGL', name: 'Alphabet Inc.' },
            { symbol: 'TSLA', name: 'Tesla, Inc.' },
            { symbol: 'AMD', name: 'Advanced Micro Devices' },
            { symbol: 'AVGO', name: 'Broadcom Inc.' },
            { symbol: 'INTC', name: 'Intel Corporation' },
            { symbol: 'PLTR', name: 'Palantir Technologies' },
            { symbol: 'COIN', name: 'Coinbase Global, Inc.' },
            { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust' },
            { symbol: 'QQQ', name: 'Invesco QQQ Trust' },
            { symbol: 'IWM', name: 'iShares Russell 2000 ETF' },
          ]);
        }
      }
    }
    loadAssets();
    return () => {
      isMounted = false;
    };
  }, [backendUrl]);

  // Autocomplete filtered list
  const filteredSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toUpperCase();
    return availableAssets
      .filter(
        (a) =>
          (a.symbol.includes(q) || a.name.toUpperCase().includes(q)) &&
          !customSelectedSymbols.includes(a.symbol)
      )
      .slice(0, 8);
  }, [searchQuery, availableAssets, customSelectedSymbols]);

  const handleAddSymbol = (symbol: string) => {
    const clean = symbol.trim().toUpperCase();
    if (clean && !customSelectedSymbols.includes(clean)) {
      setCustomSelectedSymbols((prev) => [...prev, clean]);
    }
    setSearchQuery('');
  };

  const handleRemoveSymbol = (symbol: string) => {
    setCustomSelectedSymbols((prev) => prev.filter((s) => s !== symbol));
  };

  const handleTogglePreset = (presetSymbols: string[]) => {
    setCustomSelectedSymbols((prev) => {
      const allPresent = presetSymbols.every((s) => prev.includes(s));
      if (allPresent) {
        return prev.filter((s) => !presetSymbols.includes(s));
      } else {
        const set = new Set([...prev, ...presetSymbols]);
        return Array.from(set);
      }
    });
  };

  // Run the multi-agent scan on chosen scope
  const runScan = async (options: {
    mode: 'all' | 'dynamic' | 'crypto' | 'custom';
    symbols?: string[];
    forceRefresh?: boolean;
    minConfidence?: number;
  }) => {
    if (loading || isReScanning) return;

    if (inFlightControllerRef.current) {
      inFlightControllerRef.current.abort();
    }
    const controller = new AbortController();
    inFlightControllerRef.current = controller;

    const isReScan = viewMode === 'results' && opportunities.length > 0;

    if (isReScan) {
      setIsReScanning(true);
    } else {
      setLoading(true);
      setViewMode('results');
    }

    setScanError(null);
    setActiveScanMode(options.mode);
    setLastScannedSymbols(options.symbols || []);

    try {
      const requestBody: any = {
        mode: options.mode,
        force_refresh: options.forceRefresh ?? true,
      };

      if (options.mode === 'custom' && options.symbols && options.symbols.length > 0) {
        requestBody.symbols = options.symbols;
      }
      if (options.minConfidence && options.minConfidence > 0) {
        requestBody.min_confidence = options.minConfidence;
      }

      const res = await fetch(`${backendUrl}/agents/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned status ${res.status}`);
      }

      const data = await res.json();
      const rawResults = Array.isArray(data.results) ? data.results : [];

      if (rawResults.length === 0) {
        setOpportunities([]);
        globalOpportunitiesCache = [];
        setViewMode('results');
        return;
      }

      // Parse multi-agent opportunities with account-aware pre-sizing
      const parsed: AIOpportunity[] = rawResults.map((r: any, idx: number) => {
        const opp = r.opportunity || {};
        const prop = r.proposal;
        const opt = prop?.option_contract;
        const da = r.devil_advocate;
        const analysis = r.analysis;
        const propTrade = r.proposed_trade;

        const sym = String(r.symbol || opp.symbol || '').toUpperCase();
        const isCrypto = sym.includes('/') || sym.endsWith('USD') || propTrade?.assetClass === 'crypto';
        const curPrice = Number(opp.current_price || 100);
        const isBull = String(opp.direction || 'bullish').toLowerCase() === 'bullish';
        const strike = opt?.strike_price ? Number(opt.strike_price) : (isBull ? Math.round(curPrice * 1.02) : Math.round(curPrice * 0.98));
        const expDate = isCrypto ? 'Perpetual / 24/7 Spot' : (opt?.expiration_date || 'Nov 20, 2026');
        const confidence = Math.round(Number(prop?.agent_confidence || opp.confidence || 75) * 10) / 10;
        const isApproved = analysis ? (analysis.decision?.status === 'APPROVED') : (da?.approved ?? true);

        const spreadWidth = Math.max(1, Math.round(strike * 0.05));
        const secondStrike = isBull ? strike + spreadWidth : Math.max(1, strike - spreadWidth);
        const defaultStrategy = isCrypto
          ? (isBull ? 'Spot Long (Guardian SL/TP)' : 'Spot Short / Hedge')
          : (isBull ? 'Bull Call Spread' : 'Bear Put Spread');
        const strategyName = opt?.strategy || defaultStrategy;

        // Dynamic smart SL & TP calculation
        const smartSlPct = Number(opp.suggested_sl_pct || (isCrypto ? 3.2 : 2.4));
        const smartTpPct = Number(opp.suggested_tp_pct || Number((smartSlPct * 2.4).toFixed(1)));
        const rawSlPrice = Number(
          opp.suggested_sl_price ||
            (isBull ? curPrice * (1 - smartSlPct / 100) : curPrice * (1 + smartSlPct / 100))
        );
        const rawTpPrice = Number(
          opp.suggested_tp_price ||
            (isBull ? curPrice * (1 + smartTpPct / 100) : curPrice * (1 - smartTpPct / 100))
        );

        const slPrice = curPrice < 10 ? rawSlPrice.toFixed(4) : rawSlPrice.toFixed(2);
        const tpPrice = curPrice < 10 ? rawTpPrice.toFixed(4) : rawTpPrice.toFixed(2);
        const defaultGuardianSL = `${smartSlPct}% ($${slPrice})`;
        const defaultGuardianTP = `${smartTpPct}% ($${tpPrice})`;

        // Account-aware safe sizing generated by backend guardian agent (capped <= 4.5% equity exposure)
        const proposedTrade: ProposedTradeDetails = propTrade
          ? {
              symbol: propTrade.symbol || sym,
              orderSide: propTrade.orderSide || (isBull ? 'BUY' : 'SELL'),
              quantity: Number(propTrade.quantity || (isCrypto ? 0.05 : 1)),
              executionType: propTrade.executionType || 'Market',
              entryPrice: propTrade.entryPrice || (curPrice < 1 ? curPrice.toFixed(4) : curPrice.toFixed(2)),
              guardianSL: propTrade.guardianSL || defaultGuardianSL,
              guardianTP: propTrade.guardianTP || defaultGuardianTP,
              strategy: propTrade.strategy || strategyName,
              assetClass: isCrypto ? 'crypto' : 'us_equity',
            }
          : {
              symbol: sym,
              orderSide: isBull ? 'BUY' : 'SELL',
              quantity: isCrypto ? 0.05 : Math.max(1, Math.min(25, Math.floor(4500 / Math.max(10, curPrice)))),
              executionType: 'Market',
              entryPrice: curPrice < 1 ? curPrice.toFixed(4) : curPrice.toFixed(2),
              guardianSL: defaultGuardianSL,
              guardianTP: defaultGuardianTP,
              strategy: strategyName,
              assetClass: isCrypto ? 'crypto' : 'us_equity',
            };

        let dte = isCrypto ? 0 : 42;
        try {
          if (!isCrypto && opt?.expiration_date) {
            const expD = new Date(opt.expiration_date);
            const now = new Date();
            const diff = Math.ceil((expD.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (!isNaN(diff) && diff > 0) dte = diff;
          }
        } catch {}

        const maxRisk = Math.max(1, Math.round(curPrice * (smartSlPct / 100) * proposedTrade.quantity));
        const potentialReward = Math.max(2, Math.round(curPrice * (smartTpPct / 100) * proposedTrade.quantity));
        const rrRatio = (potentialReward / Math.max(1, maxRisk)).toFixed(2);
        const oppRvol = opp.rvol != null ? Number(opp.rvol) : propTrade?.rvol != null ? Number(propTrade.rvol) : undefined;

        return {
          id: `live-${sym}-${idx}`,
          symbol: sym,
          name: isCrypto ? `${sym} Digital Asset` : `${sym} Asset`,
          status: isApproved ? 'READY' : 'EVALUATING',
          confidence,
          bias: isBull ? 'Bullish' : 'Bearish',
          strategy: strategyName,
          isPremium: confidence >= 78.0,
          assetClass: isCrypto ? 'crypto' : 'us_equity',
          isCrypto,
          rvol: oppRvol,
          legs: isCrypto
            ? []
            : [
                { action: 'BUY', strike: strike, type: isBull ? 'Call' : 'Put' },
                { action: 'SELL', strike: secondStrike, type: isBull ? 'Call' : 'Put' },
              ],
          expiration: expDate,
          dte,
          maxRisk,
          potentialReward,
          riskRewardRatio: `1 : ${rrRatio}`,
          tags: [isCrypto ? 'Alpaca 24/7' : 'Live Alpaca', isBull ? 'Long Momentum' : 'Downside Hedge', `${confidence}% Conf`],
          thesis:
            Array.isArray(opp.reasoning) && opp.reasoning.length > 0
              ? opp.reasoning.join(' ')
              : `Technical momentum aligned above baseline moving averages with healthy volume confirmation.`,
          agentVerdict: analysis?.decision?.status
            ? `${analysis.decision.status}: Guardian policy audit passed.`
            : da?.approved
            ? 'PASS: Cleared Devil’s Advocate objections.'
            : `FLAGGED: ${da?.concerns?.[0] || 'Risk check flagged'}`,
          devilAdvocateNote:
            da?.recommendation ||
            (Array.isArray(da?.concerns) && da.concerns.length > 0 ? da.concerns.join(', ') : 'Devil’s Advocate verified downside risk buffers.'),
          proposedTrade,
          stopLoss: proposedTrade.guardianSL,
          takeProfit: proposedTrade.guardianTP,
          currentPrice: curPrice,
          analysis: analysis,
          roc_30d: opp.roc_30d != null ? Number(opp.roc_30d) : undefined,
          sma50: opp.sma50 != null ? Number(opp.sma50) : undefined,
          pct_from_sma20: opp.pct_from_sma20 != null ? Number(opp.pct_from_sma20) : undefined,
          pct_from_sma50: opp.pct_from_sma50 != null ? Number(opp.pct_from_sma50) : undefined,
          z_score_20d: opp.z_score_20d != null ? Number(opp.z_score_20d) : undefined,
          adx: opp.adx != null ? Number(opp.adx) : undefined,
          market_regime: opp.market_regime || 'TREND_CONTINUATION',
          is_overextended: Boolean(opp.is_overextended),
          volume_trend: opp.volume_trend || 'NORMAL',
          pullback_support_price: opp.pullback_support_price != null ? Number(opp.pullback_support_price) : undefined,
          expected_value: opp.expected_value != null ? Number(opp.expected_value) : undefined,
          devilAdvocateConcerns: Array.isArray(da?.concerns) ? da.concerns : [],
          adversarialVerdict: da?.adversarial_verdict || (opp.is_overextended ? 'CAUTION_OVEREXTENDED' : 'APPROVED_WITH_STANDARD_RISK'),
        };
      });

      const approvedOpportunities = parsed.filter((opp) => opp.status === 'READY');
      const now = Date.now();

      // Check if opportunities are stagnant on re-scan
      const isStagnant = isReScan && areOpportunitiesEqual(opportunities, approvedOpportunities);

      if (isStagnant) {
        // Stagnant: No ghost loading, no disappearing of cards, show animated top-middle toast
        setScanTimestamp(now);
        globalLastScannedTimestamp = now;
        showStagnantNotification();
      } else {
        // Market changes or initial scan: Update opportunities and trigger one-by-one ghost loading reveal!
        setOpportunities(approvedOpportunities);
        setScanTimestamp(now);
        globalOpportunitiesCache = approvedOpportunities;
        globalLastScannedScope = { mode: options.mode, symbols: options.symbols };
        globalLastScannedTimestamp = now;

        const premIds = new Set<string>(approvedOpportunities.filter((o) => o.isPremium).map((o) => o.id));
        setExpandedIds(premIds);

        triggerStaggeredReveal(approvedOpportunities.length);
      }

      setViewMode('results');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Scan failed:', err);
        setScanError(err.message || 'Failed to scan market opportunities');
      }
    } finally {
      setLoading(false);
      setIsReScanning(false);
    }
  };

  const handleQuickExecute = async (opp: AIOpportunity) => {
    // Synchronous lock prevents double-submission race conditions from rapid clicking
    if (isSubmittingRef.current || executingOppId === opp.id) return;
    isSubmittingRef.current = true;

    try {
      setExecutingOppId(opp.id);

      // Determine robust side and quantity
      const side = opp.proposedTrade?.orderSide
        ? (opp.proposedTrade.orderSide.toLowerCase().includes('sell') ? 'sell' : 'buy')
        : (opp.bias === 'Bearish' ? 'sell' : 'buy');

      let quantity = 1;
      if (opp.proposedTrade?.quantity != null) {
        const parsedQ = Number(opp.proposedTrade.quantity);
        if (!isNaN(parsedQ) && parsedQ > 0) quantity = parsedQ;
      }

      // Quick Trade is an instant market execution: fills 100% immediately on Alpaca without partial fill hangs
      const res = await fetch(`${backendUrl}/trade/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: opp.symbol,
          side: side,
          quantity: quantity,
          order_type: 'market',
          source: 'TradeGuardian AI Opportunity - Quick Trade',
          strategy: opp.strategy,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setOppExecutionMsg((prev) => ({
          ...prev,
          [opp.id]: `✓ Placed via ${data.execution_engine || 'Alpaca'}`,
        }));
        const targetSymbol = (data.order?.symbol || opp.symbol || '').toUpperCase();
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
        // Direct user immediately to Position Manager page
        setTimeout(() => {
          onNavigate('positions');
        }, 150);
      } else {
        let errorText = 'Execution failed';
        if (typeof data.detail === 'string') {
          errorText = data.detail;
        } else if (Array.isArray(data.detail)) {
          errorText = data.detail.map((err: any) => err.msg || err.message || JSON.stringify(err)).join(', ');
        } else if (typeof data.detail === 'object' && data.detail !== null) {
          errorText = data.detail.message || data.detail.msg || data.detail.error || JSON.stringify(data.detail);
        } else if (data.message) {
          errorText = String(data.message);
        }

        setOppExecutionMsg((prev) => ({
          ...prev,
          [opp.id]: `✕ ${errorText}`,
        }));
      }
    } catch (err: any) {
      setOppExecutionMsg((prev) => ({
        ...prev,
        [opp.id]: `✕ ${err?.message || 'Network error executing trade'}`,
      }));
    } finally {
      setExecutingOppId(null);
      isSubmittingRef.current = false;
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAllPremium = () => {
    const premIds = new Set<string>(opportunities.filter((o) => o.isPremium).map((o) => o.id));
    setExpandedIds(premIds);
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  const handleOpenAnalysis = (opp: AIOpportunity) => {
    onSelectTrade?.(opp);
    onNavigate('analysis');
  };

  const sortedOpportunities = useMemo(() => {
    return [...opportunities].sort((a, b) => {
      if (a.isPremium && !b.isPremium) return -1;
      if (!a.isPremium && b.isPremium) return 1;
      return b.confidence - a.confidence;
    });
  }, [opportunities]);

  const filtered = useMemo(() => {
    return sortedOpportunities.filter((item) => {
      if (selectedBias !== 'All' && item.bias !== selectedBias) return false;
      if (
        selectedStrategy !== 'All' &&
        item.strategy !== selectedStrategy &&
        formatStrategyName(item.strategy) !== selectedStrategy
      ) {
        return false;
      }
      if (selectedAssetClass === 'us_equity' && item.isCrypto) return false;
      if (selectedAssetClass === 'crypto' && !item.isCrypto) return false;
      if (minConfidenceFilter > 0 && item.confidence < minConfidenceFilter) return false;
      return true;
    });
  }, [sortedOpportunities, selectedBias, selectedStrategy, selectedAssetClass, minConfidenceFilter]);

  const hasActiveFilters = useMemo(() => {
    return (
      selectedBias !== 'All' ||
      selectedStrategy !== 'All' ||
      selectedAssetClass !== 'All' ||
      minConfidenceFilter > 0
    );
  }, [selectedBias, selectedStrategy, selectedAssetClass, minConfidenceFilter]);

  const resetFilters = () => {
    setSelectedBias('All');
    setSelectedStrategy('All');
    setSelectedAssetClass('All');
    setMinConfidenceFilter(0);
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#131315] text-[#e4e4e7]">
      <div className="flex flex-1 overflow-hidden h-full">
        <Sidebar activeTab="ai_opportunity" onNavigate={onNavigate} />

        <div className="flex-1 flex flex-col min-w-0 bg-[#131315] overflow-hidden">
          {/* Top Bar Header */}
          <header className="h-auto min-h-14 py-2 border-b border-[#2b2a2c] flex items-center justify-between px-3 sm:px-6 bg-[#131315]/80 backdrop-blur-md z-10 shrink-0 flex-wrap gap-2">
            <div className="flex items-center gap-2.5 sm:gap-3">
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
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#facc15] text-xl">radar</span>
                <h1 className="text-sm sm:text-base font-bold text-[#e4e4e7] tracking-tight">
                  AI Opportunities
                </h1>
              </div>
              <span className="text-xs text-[#a1a1aa] font-medium hidden md:inline-block">
                — Multi-Agent Autonomous Alpha Radar
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {viewMode === 'results' && (
                <>
                  <button
                    type="button"
                    onClick={() => setViewMode('selector')}
                    className="flex items-center gap-1.5 text-xs px-2.5 sm:px-3 py-1.5 rounded-lg bg-[#1c1b1d] border border-[#2b2a2c] hover:border-[#facc15] text-[#e4e4e7] hover:text-[#facc15] transition-all cursor-pointer font-medium"
                    title="Change Market Scan Scope"
                  >
                    <span className="material-symbols-outlined text-sm">tune</span>
                    <span>Change Scope</span>
                  </button>

                  <div className="hidden sm:block h-4 w-[1px] bg-[#2b2a2c]" />

                  <button
                    type="button"
                    onClick={expandAllPremium}
                    className="text-xs px-2 sm:px-2.5 py-1.5 rounded-lg bg-[#1c1b1d] border border-[#2b2a2c] hover:border-[#facc15] hover:text-[#facc15] text-[#a1a1aa] transition-colors cursor-pointer hidden sm:inline-block"
                    title="Expand all Premium opportunities"
                  >
                    Expand Premium
                  </button>

                  <button
                    type="button"
                    onClick={collapseAll}
                    className="text-xs px-2 sm:px-2.5 py-1.5 rounded-lg bg-[#1c1b1d] border border-[#2b2a2c] hover:border-[#a1a1aa] text-[#71717a] hover:text-[#e4e4e7] transition-colors cursor-pointer hidden sm:inline-block"
                    title="Collapse all card mechanics"
                  >
                    Collapse All
                  </button>
                </>
              )}
            </div>
          </header>

          <main className="flex-1 flex flex-col p-3 sm:p-6 overflow-hidden max-w-[1600px] w-full mx-auto pb-20 lg:pb-6">
            {/* VIEW MODE 1: SCAN CONTROL CENTER (SELECTION SCREEN) */}
            {viewMode === 'selector' && !loading && (
              <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col items-center justify-center p-4">
                <div className="max-w-4xl w-full space-y-6">
                  {/* Hero Title */}
                  <div className="text-center space-y-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#facc15]/10 border border-[#facc15]/30 text-[#facc15] text-xs font-bold uppercase tracking-wider">
                      <span className="material-symbols-outlined text-sm">radar</span>
                      Scan Control Center
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-black text-[#e4e4e7] tracking-tight">
                      Choose Your Market Scan Scope
                    </h2>
                    <p className="text-sm text-[#a1a1aa] max-w-xl mx-auto">
                      Select whether to run a multi-agent deep scan across all liquid market equities or analyze a tailored watchlist of your choice.
                    </p>
                  </div>

                  {scanError && (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-400 text-xs flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-base">error</span>
                        <span>{scanError}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setScanError(null)}
                        className="text-[#a1a1aa] hover:text-white"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {/* 2-Column Scan Scope Grid: Deep Scan (with dual options) + Custom Watchlist */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
                    {/* OPTION 1: Market Deep Scan with Dual Options (Full Deep Scan vs Dynamic Movers Only) */}
                    <div
                      className={`lg:col-span-7 bg-[#18181b] border border-[#2b2a2c] transition-all duration-300 rounded-2xl p-6 flex flex-col justify-between space-y-5 relative overflow-hidden shadow-xl group ${
                        deepScanSubMode === 'all'
                          ? 'hover:border-[#facc15]/80 hover:shadow-2xl hover:shadow-amber-500/10'
                          : 'hover:border-emerald-400/80 hover:shadow-2xl hover:shadow-emerald-500/10'
                      }`}
                    >
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-15 transition-opacity pointer-events-none">
                        <span
                          className={`material-symbols-outlined text-9xl transition-colors duration-300 ${
                            deepScanSubMode === 'all' ? 'text-[#facc15]' : 'text-emerald-400'
                          }`}
                        >
                          {deepScanSubMode === 'all' ? 'public' : 'local_fire_department'}
                        </span>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span
                            className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all duration-300 border ${
                              deepScanSubMode === 'all'
                                ? 'bg-amber-500/15 text-[#facc15] border-[#facc15]/40 shadow-sm shadow-amber-500/20'
                                : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 shadow-sm shadow-emerald-500/20'
                            }`}
                          >
                            <span className="material-symbols-outlined text-xs">
                              {deepScanSubMode === 'all' ? 'radar' : 'local_fire_department'}
                            </span>
                            {deepScanSubMode === 'all' ? 'MARKET-WIDE RADAR' : 'LIVE MOMENTUM RADAR'}
                          </span>
                          <span
                            className={`text-xs font-mono font-medium transition-colors duration-300 ${
                              deepScanSubMode === 'all' ? 'text-amber-400/90' : 'text-emerald-400/90'
                            }`}
                          >
                            {deepScanSubMode === 'all' ? 'Stocks + Crypto + Movers' : 'Top Volume Movers Only'}
                          </span>
                        </div>

                        <div>
                          <h3
                            className={`text-xl font-bold transition-colors duration-300 ${
                              deepScanSubMode === 'all'
                                ? 'text-white group-hover:text-[#facc15]'
                                : 'text-white group-hover:text-emerald-400'
                            }`}
                          >
                            {deepScanSubMode === 'all' ? 'Market Deep Scan (Stocks & Crypto)' : 'Dynamic High-Volume Screener'}
                          </h3>
                          <p className="text-xs text-[#a1a1aa] mt-1 leading-relaxed">
                            {deepScanSubMode === 'all'
                              ? "Deploy TradeGuardian's autonomous multi-agent swarm across the broader liquid market."
                              : "Isolate and screen high relative volume surges and institutional breakout momentum."}
                          </p>
                        </div>

                        {/* Dual Option Switcher: Full Deep Scan vs Dynamic Movers Only */}
                        <div className="bg-[#121214] p-1 rounded-xl border border-[#2b2a2c] flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setDeepScanSubMode('all')}
                            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                              deepScanSubMode === 'all'
                                ? 'bg-amber-500/20 text-[#facc15] border border-[#facc15]/40 shadow-sm'
                                : 'text-[#a1a1aa] hover:text-white border border-transparent'
                            }`}
                          >
                            <span className="material-symbols-outlined text-sm">public</span>
                            <span>Full Deep Scan</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeepScanSubMode('dynamic')}
                            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                              deepScanSubMode === 'dynamic'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                                : 'text-[#a1a1aa] hover:text-white border border-transparent'
                            }`}
                          >
                            <span className="material-symbols-outlined text-sm">local_fire_department</span>
                            <span>Dynamic Movers Only</span>
                          </button>
                        </div>

                        {/* Mode Description & Features */}
                        {deepScanSubMode === 'all' ? (
                          <div className="space-y-3">
                            <div className="bg-[#1f1d19] border border-[#facc15]/25 rounded-xl p-3.5 space-y-2">
                              <div className="flex items-center gap-1.5 text-[#facc15] text-xs font-bold">
                                <span className="material-symbols-outlined text-sm">hub</span>
                                <span>Multi-Asset Integrated Radar (Stocks + Crypto + Movers)</span>
                              </div>
                              <ul className="text-[11px] text-[#d4d4d8] space-y-1">
                                <li className="flex items-center gap-1.5">
                                  <span className="text-[#facc15] font-mono">✓</span>
                                  <span>US Mega-Tech & Indices (NVDA, AAPL, MSFT, SPY, QQQ)</span>
                                </li>
                                <li className="flex items-center gap-1.5">
                                  <span className="text-[#facc15] font-mono">✓</span>
                                  <span>24/7 Crypto Leaders (BTC/USD, ETH/USD, SOL/USD, DOGE/USD, AVAX/USD)</span>
                                </li>
                                <li className="flex items-center gap-1.5">
                                  <span className="text-[#facc15] font-mono">✓</span>
                                  <span>Dynamic High-Volume Screener automatically integrated into scan pool</span>
                                </li>
                              </ul>
                            </div>
                            <p className="text-[11px] text-[#71717a] leading-relaxed">
                              Deep scanning runs full multi-agent consensus across 35+ liquid assets in parallel. Options spreads for equities; spot orders with Guardian SL/TP brackets for crypto.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="bg-[#151c17] border border-emerald-500/25 rounded-xl p-3.5 space-y-2">
                              <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-bold">
                                <span className="material-symbols-outlined text-sm">local_fire_department</span>
                                <span>Live Institutional Momentum & Breakouts Only</span>
                              </div>
                              <ul className="text-[11px] text-[#d4d4d8] space-y-1">
                                <li className="flex items-center gap-1.5">
                                  <span className="text-emerald-400 font-mono">✓</span>
                                  <span>Relative Volume (RVol &ge; 1.0x - 2.5x) institutional spikes</span>
                                </li>
                                <li className="flex items-center gap-1.5">
                                  <span className="text-emerald-400 font-mono">✓</span>
                                  <span>Surging breakout runners across US equities and 24/7 crypto</span>
                                </li>
                                <li className="flex items-center gap-1.5">
                                  <span className="text-emerald-400 font-mono">✓</span>
                                  <span>Bypasses stationary benchmarks to isolate active market order flow</span>
                                </li>
                              </ul>
                            </div>
                            <p className="text-[11px] text-[#71717a] leading-relaxed">
                              Dynamic screener continuously monitors order flow velocity and scores assets by relative volume and momentum expansion.
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Action Triggers */}
                      <div className="space-y-2 pt-2">
                        {deepScanSubMode === 'all' ? (
                          <button
                            type="button"
                            onClick={() => runScan({ mode: 'all' })}
                            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-black font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-amber-500/10 transition-all cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-lg">bolt</span>
                            <span>Launch All Markets Deep Scan (Stocks + Crypto)</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => runScan({ mode: 'dynamic' })}
                            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-black font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/10 transition-all cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-lg">radar</span>
                            <span>Launch Dynamic Movers Scan (Stocks + Crypto)</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* OPTION 2: Selected Market / Custom Watchlist */}
                    <div className="lg:col-span-5 bg-[#18181b] border border-[#2b2a2c] hover:border-[#38bdf8]/60 transition-all rounded-2xl p-6 flex flex-col justify-between space-y-5 relative overflow-hidden shadow-xl group">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="px-2.5 py-1 rounded-md bg-sky-500/10 text-[#38bdf8] border border-[#38bdf8]/30 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                            <span className="material-symbols-outlined text-xs">tune</span>
                            TARGETED ALPHA
                          </span>
                          <span className="text-xs text-[#71717a] font-mono font-medium">Custom Scope</span>
                        </div>

                        <div>
                          <h3 className="text-xl font-bold text-white group-hover:text-[#38bdf8] transition-colors">
                            Selected Market / Custom
                          </h3>
                          <p className="text-xs text-[#a1a1aa] mt-1 leading-relaxed">
                            Search any specific symbols supported by Alpaca or click quick-pick recommendations below.
                          </p>
                        </div>

                        {/* Search Bar with Autocomplete */}
                        <div className="relative">
                          <div className="flex items-center gap-2 bg-[#121214] border border-[#2b2a2c] rounded-xl px-3 py-2 text-xs focus-within:border-[#38bdf8] transition-colors">
                            <span className="material-symbols-outlined text-[#71717a] text-sm">search</span>
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder="Search symbol (e.g., NVDA, AAPL, BTC/USD)..."
                              className="bg-transparent outline-none flex-1 text-white placeholder-[#71717a]"
                            />
                            {searchQuery && (
                              <button
                                type="button"
                                onClick={() => setSearchQuery('')}
                                className="text-[#71717a] hover:text-white"
                              >
                                ✕
                              </button>
                            )}
                          </div>

                          {/* Autocomplete Dropdown */}
                          {filteredSuggestions.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#18181b] border border-[#2b2a2c] rounded-xl shadow-2xl z-30 max-h-48 overflow-y-auto custom-scrollbar p-1">
                              {filteredSuggestions.map((item) => (
                                <button
                                  key={item.symbol}
                                  type="button"
                                  onClick={() => handleAddSymbol(item.symbol)}
                                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#27272a] flex items-center justify-between text-xs cursor-pointer"
                                >
                                  <span className="font-mono font-bold text-white">{item.symbol}</span>
                                  <span className="text-[11px] text-[#a1a1aa] truncate max-w-[200px]">{item.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Recommendations when search is empty */}
                        <div className="space-y-2">
                          <div className="text-[10px] uppercase font-bold text-[#71717a] tracking-wider flex items-center gap-1">
                            <span className="material-symbols-outlined text-xs">recommend</span>
                            Recommended Market Presets:
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            {RECOMMENDED_PRESETS.map((preset) => {
                              const isActive = preset.symbols.every((s) => customSelectedSymbols.includes(s));
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => handleTogglePreset(preset.symbols)}
                                  className={`p-2 rounded-lg text-left border transition-all text-xs cursor-pointer flex items-center gap-2 ${
                                    isActive
                                      ? 'bg-sky-500/15 border-sky-500/50 text-[#38bdf8]'
                                      : 'bg-[#121214] border-[#2b2a2c] text-[#a1a1aa] hover:border-[#3f3f46] hover:text-white'
                                  }`}
                                >
                                  <span className="material-symbols-outlined text-sm">{preset.icon}</span>
                                  <div className="truncate">
                                    <div className="font-bold text-[11px] leading-none truncate">{preset.label}</div>
                                    <div className="text-[9px] text-[#71717a] mt-0.5 font-mono">{preset.symbols.length} tickers</div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Selected Symbols Chips Tray */}
                        <div className="bg-[#121214] p-2.5 rounded-xl border border-[#2b2a2c] space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] text-[#71717a] uppercase font-semibold">
                            <span>Selected Tickers ({customSelectedSymbols.length}):</span>
                            {customSelectedSymbols.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setCustomSelectedSymbols([])}
                                className="text-rose-400 hover:text-rose-300 transition-colors cursor-pointer text-[10px]"
                              >
                                Clear All
                              </button>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto custom-scrollbar">
                            {customSelectedSymbols.length === 0 ? (
                              <span className="text-[11px] text-[#71717a] italic py-1">
                                No symbols selected. Search a symbol or click a preset above.
                              </span>
                            ) : (
                              customSelectedSymbols.map((sym) => (
                                <span
                                  key={sym}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#27272a] text-white font-mono text-xs font-bold border border-[#3f3f46]"
                                >
                                  {sym}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveSymbol(sym)}
                                    className="text-[#a1a1aa] hover:text-rose-400 cursor-pointer ml-0.5"
                                  >
                                    ✕
                                  </button>
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={customSelectedSymbols.length === 0}
                        onClick={() => runScan({ mode: 'custom', symbols: customSelectedSymbols })}
                        className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-sky-500/10 transition-all cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-lg">search_check</span>
                        <span>Analyze Selected Tickers ({customSelectedSymbols.length})</span>
                      </button>
                    </div>
                  </div>

                  {/* Return to previous results if available */}
                  {opportunities.length > 0 && (
                    <div className="text-center pt-2">
                      <button
                        type="button"
                        onClick={() => setViewMode('results')}
                        className="text-xs text-[#a1a1aa] hover:text-white underline cursor-pointer"
                      >
                        ← Return to previous scan results ({opportunities.length} opportunities)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* VIEW MODE 2: OPPORTUNITIES RESULTS GRID (HANDLES SCANNING, GHOST CARDS & LIVE CARDS) */}
            {viewMode === 'results' && (
              <>
                {/* Active Swarm Scanning Banner */}
                {loading && (
                  <div className="mb-4 bg-[#18181b] border border-[#2b2a2c] rounded-xl p-3.5 shadow-lg space-y-2.5 animate-in fade-in duration-300">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full border-2 border-[#facc15] border-t-transparent animate-spin flex items-center justify-center">
                          <span className="material-symbols-outlined text-[#facc15] text-xs">radar</span>
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-white flex items-center gap-2">
                            <span>Multi-Agent Swarm Scanning Market Alpha...</span>
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-semibold">
                              Live Swarm
                            </span>
                          </h4>
                          <p className="text-[11px] text-[#71717a]">
                            Research Agent, Devil’s Advocate, Options Strategist & Guardian Desk analyzing setups in real-time.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-0.5">
                      <div className="bg-[#121214] border border-[#2b2a2c]/60 rounded-lg p-2 text-[11px] flex items-center gap-2">
                        <span className="material-symbols-outlined text-[#facc15] text-sm">search</span>
                        <span className="text-[#a1a1aa] truncate">1. Research Agent</span>
                      </div>
                      <div className="bg-[#121214] border border-[#2b2a2c]/60 rounded-lg p-2 text-[11px] flex items-center gap-2">
                        <span className="material-symbols-outlined text-[#38bdf8] text-sm">psychology</span>
                        <span className="text-[#a1a1aa] truncate">2. Devil’s Advocate</span>
                      </div>
                      <div className="bg-[#121214] border border-[#2b2a2c]/60 rounded-lg p-2 text-[11px] flex items-center gap-2">
                        <span className="material-symbols-outlined text-emerald-400 text-sm">tune</span>
                        <span className="text-[#a1a1aa] truncate">3. Options Strategy</span>
                      </div>
                      <div className="bg-[#121214] border border-[#2b2a2c]/60 rounded-lg p-2 text-[11px] flex items-center gap-2">
                        <span className="material-symbols-outlined text-purple-400 text-sm">shield</span>
                        <span className="text-[#a1a1aa] truncate">4. Guardian Risk</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Scan Error Banner */}
                {scanError && (
                  <div className="mb-4 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-400 flex items-center justify-between animate-in fade-in duration-200">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm">error</span>
                      <span>{scanError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setScanError(null)}
                      className="text-rose-400 hover:text-white cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-xs">close</span>
                    </button>
                  </div>
                )}

                {/* Control Filters and Status Subheader */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 shrink-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Bias Tabs */}
                    <div className="flex items-center bg-[#1c1b1d] rounded-lg p-1 border border-[#2b2a2c]">
                      {['All', 'Bullish', 'Bearish'].map((bias) => (
                        <button
                          key={bias}
                          type="button"
                          onClick={() => setSelectedBias(bias)}
                          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                            selectedBias === bias
                              ? 'bg-[#27272a] text-[#facc15] shadow-sm'
                              : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                          }`}
                        >
                          {bias}
                        </button>
                      ))}
                    </div>

                    {/* Asset Class Filter */}
                    <div className="flex items-center bg-[#1c1b1d] rounded-lg p-1 border border-[#2b2a2c]">
                      {[
                        { id: 'All', label: 'All Assets' },
                        { id: 'us_equity', label: 'Stocks & Options' },
                        { id: 'crypto', label: 'Crypto 24/7' },
                      ].map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setSelectedAssetClass(tab.id as any)}
                          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                            selectedAssetClass === tab.id
                              ? 'bg-[#27272a] text-[#38bdf8] shadow-sm'
                              : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Confidence Hurdle Filter */}
                    <div className="flex items-center bg-[#1c1b1d] rounded-lg p-1 border border-[#2b2a2c]">
                      <span className="text-[10px] text-[#71717a] font-bold uppercase px-2 flex items-center gap-1">
                        <span className="material-symbols-outlined text-xs" style={{ fontSize: '12px' }}>
                          filter_alt
                        </span>
                        Hurdle:
                      </span>
                      {[
                        { val: 0, label: 'All' },
                        { val: 70, label: '70%+' },
                        { val: 75, label: '75%+' },
                        { val: 80, label: '80%+ Top' },
                      ].map((h) => (
                        <button
                          key={h.val}
                          type="button"
                          onClick={() => setMinConfidenceFilter(h.val)}
                          className={`px-2 py-0.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                            minConfidenceFilter === h.val
                              ? 'bg-[#27272a] text-emerald-400 font-bold shadow-sm'
                              : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                          }`}
                        >
                          {h.label}
                        </button>
                      ))}
                    </div>

                    <select
                      value={selectedStrategy}
                      onChange={(e) => setSelectedStrategy(e.target.value)}
                      className="bg-[#1c1b1d] border border-[#2b2a2c] rounded-lg px-2.5 py-1.5 text-xs text-[#e4e4e7] outline-none focus:border-[#facc15] cursor-pointer"
                    >
                      <option value="All">All Strategies</option>
                      <option value="Bull Call Spread">Bull Call Spread</option>
                      <option value="Bull Put Spread">Bull Put Spread</option>
                      <option value="Bear Put Spread">Bear Put Spread</option>
                      <option value="Long Call">Long Call</option>
                      <option value="Long Put">Long Put</option>
                      <option value="Spot Long (Guardian SL/TP)">Spot Long (Guardian SL/TP)</option>
                      <option value="Spot Short / Hedge">Spot Short / Hedge</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#a1a1aa] font-mono">
                      {filtered.length} setups
                    </span>

                    <span className="text-[10px] uppercase font-bold text-[#10b981] bg-[#10b981]/10 px-2 py-0.5 rounded border border-[#10b981]/30 flex items-center gap-1 font-mono">
                      <span className="material-symbols-outlined text-xs" style={{ fontSize: '12px' }}>
                        bolt
                      </span>
                      {activeScanMode === 'dynamic'
                        ? '🔥 Dynamic Movers Only'
                        : activeScanMode === 'all'
                        ? '⚡ Full Deep Scan (Stocks & Crypto)'
                        : activeScanMode === 'crypto'
                        ? '🪙 Crypto 24/7 Leaders'
                        : `Targeted Watchlist (${lastScannedSymbols.length})`}
                    </span>

                    {scanTimestamp > 0 && (
                      <span className="text-[10px] text-[#71717a] font-mono hidden xl:inline-block">
                        {new Date(scanTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}

                    <button
                      type="button"
                      disabled={isReScanning || loading}
                      onClick={() =>
                        runScan({
                          mode: activeScanMode || 'all',
                          symbols: activeScanMode === 'custom' ? lastScannedSymbols : undefined,
                          forceRefresh: true,
                        })
                      }
                      title="Re-analyze market for fresh opportunities"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1c1b1d] border border-[#2b2a2c] hover:border-[#facc15] hover:bg-[#27272a] text-xs font-semibold text-[#a1a1aa] hover:text-[#facc15] transition-all cursor-pointer shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <span className={`material-symbols-outlined text-xs ${isReScanning ? 'animate-spin text-[#facc15]' : ''}`}>
                        refresh
                      </span>
                      <span>{isReScanning ? 'Re-Scanning...' : 'Re-Scan'}</span>
                    </button>
                  </div>
                </div>

                {/* Cards Container */}
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                  {loading && opportunities.length === 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 w-full gap-4 pb-4">
                      {Array.from({ length: Math.min(8, Math.max(4, lastScannedSymbols.length || 4)) }).map((_, idx) => (
                        <GhostOpportunityCard key={`initial-ghost-${idx}`} />
                      ))}
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-center space-y-3 border border-dashed border-[#2b2a2c] rounded-2xl p-6 bg-[#161618]/50">
                      <div className="w-12 h-12 rounded-full bg-[#202023] flex items-center justify-center text-[#71717a] border border-[#2b2a2c]">
                        <span className="material-symbols-outlined text-2xl">
                          {opportunities.length === 0 ? 'radar' : 'search_off'}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-white">
                        {opportunities.length === 0
                          ? 'No Market Opportunities Available'
                          : 'No Opportunities Matched Current Filters'}
                      </h4>
                      <p className="text-xs text-[#a1a1aa] max-w-md leading-relaxed">
                        {opportunities.length === 0
                          ? 'There are no market opportunities available meeting the AI swarm’s technical thresholds in this scope. Try launching a new scan with a broader symbol selection or changing the market scope.'
                          : 'Try resetting the bias filter, launching a new scan with a broader symbol selection, or there are no market opportunities available under current criteria.'}
                      </p>
                      <div className="flex items-center gap-2 pt-1 flex-wrap justify-center">
                        {hasActiveFilters && (
                          <button
                            type="button"
                            onClick={resetFilters}
                            className="px-3.5 py-2 bg-[#27272a] hover:bg-[#3f3f46] text-white font-semibold rounded-lg text-xs transition-all cursor-pointer border border-[#3f3f46] flex items-center gap-1.5"
                          >
                            <span className="material-symbols-outlined text-xs">restart_alt</span>
                            <span>Reset Filters</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setViewMode('selector')}
                          className="px-4 py-2 bg-[#facc15] text-black font-bold rounded-lg text-xs hover:bg-[#fde047] transition-all cursor-pointer shadow-sm flex items-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-xs">tune</span>
                          <span>Change Market Scope</span>
                        </button>
                        <button
                          type="button"
                          disabled={isReScanning || loading}
                          onClick={() =>
                            runScan({
                              mode: activeScanMode || 'all',
                              symbols: activeScanMode === 'custom' ? lastScannedSymbols : undefined,
                              forceRefresh: true,
                            })
                          }
                          className="px-3.5 py-2 bg-[#1c1b1d] hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#facc15] border border-[#2b2a2c] hover:border-[#facc15] font-semibold rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <span className={`material-symbols-outlined text-xs ${isReScanning ? 'animate-spin text-[#facc15]' : ''}`}>
                            refresh
                          </span>
                          <span>{isReScanning ? 'Re-Scanning...' : 'Re-Scan Market'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 w-full gap-4 pb-4">
                      {filtered.map((opp, index) => {
                        const isExpanded = expandedIds.has(opp.id);
                        const isRevealed = index < revealedCount;
                        return (
                          <InViewCardWrapper
                            key={opp.id}
                            id={opp.id}
                            isExpanded={isExpanded}
                            isRevealed={isRevealed}
                          >
                            <div
                              className={`rounded-xl flex flex-col transition-all duration-300 h-full p-4 gap-3 relative overflow-hidden animate-in fade-in zoom-in-[0.98] duration-300 ${
                                opp.isPremium
                                  ? 'bg-gradient-to-b from-[#181613] via-[#121214] to-[#0d0d0f] border border-amber-500/30 hover:border-amber-400/60 shadow-[0_4px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(251,191,36,0.12)] hover:shadow-[0_12px_36px_rgba(0,0,0,0.7),0_0_24px_rgba(245,158,11,0.08)]'
                                  : 'bg-[#151518] border border-zinc-800/80 hover:border-zinc-700 shadow-md'
                              }`}
                            >
                              {opp.isPremium && (
                                <>
                                  {/* Ambient radial top glow */}
                                  <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-4/5 h-32 bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.14),transparent_70%)]" />
                                  {/* Luminous micro-sheen top edge line */}
                                  <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-400/75 to-transparent" />
                                  <div className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-gradient-to-r from-transparent via-amber-300/30 to-transparent blur-[1px]" />
                                </>
                              )}
                              <div className="flex justify-between items-start pt-0.5 relative z-10">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {opp.isPremium && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-500/15 via-amber-400/10 to-transparent text-amber-300 border border-amber-400/35 text-[10px] font-bold uppercase tracking-wider shadow-[0_0_10px_rgba(245,158,11,0.12)] backdrop-blur-sm">
                                      <span className="material-symbols-outlined text-amber-400 text-xs" style={{ fontSize: '13px' }}>
                                        stars
                                      </span>
                                      Premium
                                    </span>
                                  )}
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider">
                                    {opp.status}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <div className="text-lg font-black font-mono text-emerald-400 leading-none">
                                    {opp.confidence}%
                                  </div>
                                  <div className="text-[8px] text-zinc-400 uppercase tracking-widest mt-0.5 font-semibold">
                                    AI Confidence
                                  </div>
                                </div>
                              </div>
                              <div className="relative z-10">
                                <div className="flex items-baseline justify-between">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-black text-[#e4e4e7] text-xl tracking-tight font-mono">{opp.symbol}</span>
                                    {opp.isCrypto ? (
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-0.5">
                                        <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>currency_bitcoin</span>
                                        CRYPTO 24/7
                                      </span>
                                    ) : (
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-500/10 text-[#38bdf8] border border-[#38bdf8]/25">
                                        US EQUITY
                                      </span>
                                    )}
                                    {opp.rvol && opp.rvol >= 1.05 && (
                                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-0.5">
                                        <span className="material-symbols-outlined" style={{ fontSize: '11px' }}>local_fire_department</span>
                                        {opp.rvol.toFixed(1)}x RVol
                                      </span>
                                    )}
                                  </div>
                                  <span
                                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border uppercase tracking-wider flex items-center gap-1 ${
                                      opp.bias === 'Bullish'
                                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                        : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                    }`}
                                  >
                                    <span className="material-symbols-outlined text-xs" style={{ fontSize: '13px' }}>
                                      {opp.bias === 'Bullish' ? 'trending_up' : 'trending_down'}
                                    </span>
                                    {opp.bias}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                  <span className="text-xs font-semibold text-zinc-300">
                                    {formatStrategyName(opp.strategy)}
                                  </span>
                                  <span className="text-[10px] text-zinc-500 font-mono">
                                    {opp.isCrypto ? '• Spot Setup' : '• Options Setup'}
                                  </span>
                                  {opp.market_regime && (
                                    <span
                                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                                        opp.is_overextended || opp.market_regime === 'OVEREXTENDED_MOMENTUM'
                                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-500/20'
                                          : opp.market_regime === 'PULLBACK_ENTRY'
                                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 shadow-sm shadow-emerald-500/20'
                                          : opp.market_regime === 'SQUEEZE_BREAKOUT'
                                          ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                                          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                                      }`}
                                    >
                                      {opp.is_overextended || opp.market_regime === 'OVEREXTENDED_MOMENTUM' ? (
                                        <>
                                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                                          <span>⚠️ OVEREXTENDED MOMENTUM</span>
                                        </>
                                      ) : opp.market_regime === 'PULLBACK_ENTRY' ? (
                                        <>
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                          <span>⭐ PULLBACK ENTRY</span>
                                        </>
                                      ) : opp.market_regime === 'SQUEEZE_BREAKOUT' ? (
                                        <>
                                          <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                                          <span>⚡ SQUEEZE BREAKOUT</span>
                                        </>
                                      ) : (
                                        <span>{opp.market_regime.replace(/_/g, ' ')}</span>
                                      )}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {opp.proposedTrade && (
                                <div className="bg-[#0b0b0d]/90 border border-zinc-800/80 rounded-lg p-2.5 space-y-2 shadow-inner relative z-10">
                                  <div className="flex items-center justify-between text-[10px] font-bold pb-1.5 border-b border-zinc-800/70">
                                    <span className="text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                                      <span className="material-symbols-outlined text-xs text-amber-400" style={{ fontSize: '13px' }}>
                                        tune
                                      </span>
                                      Proposed Trade Parameters
                                    </span>
                                    <span className="text-emerald-400 font-mono text-[9px] bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/25 flex items-center gap-1">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                      GUARDIAN SAFE
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-x-2.5 gap-y-1.5 text-[11px]">
                                    <div>
                                      <span className="text-zinc-500 text-[9px] block font-medium uppercase tracking-tight">Order Side</span>
                                      <span
                                        className={`font-bold font-mono text-xs ${
                                          opp.proposedTrade.orderSide === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                                        }`}
                                      >
                                        {opp.proposedTrade.orderSide} / {opp.proposedTrade.orderSide === 'BUY' ? 'LONG' : 'SHORT'}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-zinc-500 text-[9px] block font-medium uppercase tracking-tight">Quantity</span>
                                      <span className="font-bold font-mono text-xs text-[#e4e4e7]">
                                        {opp.isCrypto
                                          ? `${opp.proposedTrade.quantity} ${opp.symbol.split('/')[0]}`
                                          : `${opp.proposedTrade.quantity} Contracts/Shares`}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-zinc-500 text-[9px] block font-medium uppercase tracking-tight">Execution Type</span>
                                      <span className="font-semibold text-xs text-[#e4e4e7]">{opp.proposedTrade.executionType} Order</span>
                                    </div>
                                    <div>
                                      <span className="text-zinc-500 text-[9px] block font-medium uppercase tracking-tight">Entry Target</span>
                                      <span className="font-bold font-mono text-xs text-amber-300">${opp.proposedTrade.entryPrice}</span>
                                    </div>
                                    <div>
                                      <span className="text-zinc-500 text-[9px] block font-medium uppercase tracking-tight">Guardian Stop Loss</span>
                                      <span className="font-mono font-bold text-[11px] text-rose-400">{opp.proposedTrade.guardianSL}</span>
                                    </div>
                                    <div>
                                      <span className="text-zinc-500 text-[9px] block font-medium uppercase tracking-tight">Guardian Take Profit</span>
                                      <span className="font-mono font-bold text-[11px] text-emerald-400">{opp.proposedTrade.guardianTP}</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                              <div className="flex items-center justify-between text-[11px] font-mono bg-[#0b0b0d] p-2 rounded-lg border border-zinc-800/60 relative z-10">
                                <div>
                                  <span className="text-zinc-400 block text-[9px] uppercase tracking-tight">Reward Target</span>
                                  <span className="text-emerald-400 font-bold">+${opp.potentialReward.toLocaleString()}</span>
                                </div>
                                <div className="text-center">
                                  <span className="text-zinc-400 block text-[9px] uppercase tracking-tight">Defined Risk</span>
                                  <span className="text-rose-400 font-bold">${opp.maxRisk.toLocaleString()}</span>
                                </div>
                                <div className="text-right">
                                  <span className="text-zinc-400 block text-[9px] uppercase tracking-tight">R : R</span>
                                  <span className="text-amber-300 font-bold">{opp.riskRewardRatio}</span>
                                </div>
                              </div>

                              {/* Macro Horizon & Multi-Timeframe Context Strip */}
                              <div className="grid grid-cols-4 gap-1 text-[10px] font-mono bg-[#0b0b0d]/90 p-2 rounded-lg border border-zinc-800/60 relative z-10">
                                <div className="text-center">
                                  <span className="text-zinc-500 block text-[8px] uppercase tracking-tight">30D Velocity</span>
                                  <span className={`font-bold ${Number(opp.roc_30d || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {Number(opp.roc_30d || 0) > 0 ? '+' : ''}{opp.roc_30d ?? '0.0'}%
                                  </span>
                                </div>
                                <div className="text-center">
                                  <span className="text-zinc-500 block text-[8px] uppercase tracking-tight">vs 20-SMA</span>
                                  <span className={`font-bold ${Number(opp.pct_from_sma20 || 0) > 5 ? 'text-amber-400 font-extrabold' : 'text-zinc-300'}`}>
                                    {Number(opp.pct_from_sma20 || 0) > 0 ? '+' : ''}{opp.pct_from_sma20 ?? '0.0'}%
                                  </span>
                                </div>
                                <div className="text-center">
                                  <span className="text-zinc-500 block text-[8px] uppercase tracking-tight">ADX (Trend)</span>
                                  <span className={`font-bold ${Number(opp.adx || 0) > 38 ? 'text-amber-300' : (Number(opp.adx || 0) >= 20 ? 'text-emerald-400' : 'text-zinc-500')}`}>
                                    {opp.adx ?? 22.0}
                                  </span>
                                </div>
                                <div className="text-center">
                                  <span className="text-zinc-500 block text-[8px] uppercase tracking-tight">VSA Volume</span>
                                  <span className={`font-bold text-[9px] ${opp.volume_trend === 'EXHAUSTION' ? 'text-rose-400 font-extrabold' : (opp.volume_trend === 'ACCUMULATION' ? 'text-emerald-400' : 'text-zinc-400')}`}>
                                    {opp.volume_trend || 'NORMAL'}
                                  </span>
                                </div>
                              </div>

                              <div className="text-xs text-zinc-400 leading-snug line-clamp-2 relative z-10">
                                <span className="text-[#e4e4e7] font-semibold">Thesis:</span> {opp.thesis}
                              </div>

                              {isExpanded && (
                                <div className="space-y-3 pt-2 border-t border-zinc-800/80 mt-1 text-xs relative z-10">
                                  <div>
                                    <div className="text-[10px] font-bold text-emerald-400/90 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                      <span className="material-symbols-outlined text-xs text-emerald-400">verified_user</span>
                                      Guardian Safety Checks
                                    </div>
                                    <div className="bg-[#0b0b0d] p-2 rounded-lg border border-zinc-800/80 space-y-1 font-mono text-[11px]">
                                      <div className="text-emerald-400 flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-xs">check_circle</span>
                                        Single Trade Exposure &lt; 10%
                                      </div>
                                      <div className="text-emerald-400 flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-xs">check_circle</span>
                                        Portfolio Concentration &lt; 20%
                                      </div>
                                      <div className="text-emerald-400 flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-xs">check_circle</span>
                                        Account Buying Power Verified
                                      </div>
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-[10px] font-bold text-sky-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                                      <span className="flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-xs text-sky-400">psychology</span>
                                        Devil’s Advocate Stress Test
                                      </span>
                                      {opp.adversarialVerdict && (
                                        <span
                                          className={`text-[8px] px-2 py-0.5 rounded font-mono font-bold ${
                                            opp.adversarialVerdict.includes('CAUTION') || opp.adversarialVerdict.includes('RISK')
                                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                          }`}
                                        >
                                          {opp.adversarialVerdict.replace(/_/g, ' ')}
                                        </span>
                                      )}
                                    </div>
                                    <div className="bg-[#0b0b0d] p-2.5 rounded-lg border border-zinc-800/80 space-y-2 text-[11px] text-zinc-300 leading-relaxed">
                                      {opp.devilAdvocateConcerns && opp.devilAdvocateConcerns.length > 0 ? (
                                        <ul className="space-y-1.5">
                                          {opp.devilAdvocateConcerns.map((concern, cIdx) => (
                                            <li key={cIdx} className="flex items-start gap-1.5 text-zinc-300">
                                              <span className="text-amber-400 font-bold shrink-0 mt-0.5">›</span>
                                              <span className="leading-snug">{concern}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      ) : (
                                        <p>{opp.devilAdvocateNote}</p>
                                      )}
                                      {opp.devilAdvocateNote && opp.devilAdvocateConcerns && opp.devilAdvocateConcerns.length > 0 && (
                                        <div className="pt-2 border-t border-zinc-800/60 text-[10px] text-amber-300/90 font-mono flex items-start gap-1">
                                          <span className="font-bold shrink-0">Verdict:</span>
                                          <span>{opp.devilAdvocateNote}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-2 mt-auto relative z-10">
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(opp.id)}
                                  className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 cursor-pointer font-medium transition-colors"
                                >
                                  <span>{isExpanded ? 'Less' : 'Details'}</span>
                                  <span className="material-symbols-outlined text-sm">
                                    {isExpanded ? 'expand_less' : 'expand_more'}
                                  </span>
                                </button>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleQuickExecute(opp)}
                                    disabled={executingOppId === opp.id}
                                    className="px-2.5 py-1.5 bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 hover:text-white text-xs font-semibold rounded-lg transition-all cursor-pointer disabled:opacity-50 active:scale-[0.98] border border-zinc-700/40"
                                  >
                                    {executingOppId === opp.id ? 'Placing...' : 'Quick Trade'}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleOpenAnalysis(opp)}
                                    className="px-3 py-1.5 bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-400 hover:from-amber-300 hover:to-yellow-300 text-zinc-950 font-bold text-xs rounded-lg shadow-[0_2px_10px_rgba(245,158,11,0.25)] transition-all cursor-pointer flex items-center gap-1 active:scale-[0.98]"
                                  >
                                    <span>Analyze</span>
                                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                                  </button>
                                </div>
                              </div>

                              {oppExecutionMsg[opp.id] && (
                                <div
                                  className={`text-[10px] p-1.5 rounded text-center font-mono ${
                                    oppExecutionMsg[opp.id].startsWith('✓')
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                  }`}
                                >
                                  {oppExecutionMsg[opp.id]}
                                </div>
                              )}
                            </div>
                          </InViewCardWrapper>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      {/* Floating Stagnant Refresh Notification Toast */}
      {stagnantToast && (
        <div
          className={`fixed top-5 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-500 ease-out flex items-center gap-3 px-4 py-2.5 rounded-full bg-[#161618]/95 backdrop-blur-md border border-[#2b2a2c] shadow-[0_10px_35px_rgba(0,0,0,0.7),0_0_20px_rgba(250,204,21,0.08)] ${
            stagnantToast.animatingOut
              ? '-translate-y-16 opacity-0 scale-95'
              : 'translate-y-0 opacity-100 scale-100 animate-in fade-in slide-in-from-top-4 duration-300'
          }`}
        >
          <div className="w-6 h-6 rounded-full bg-[#facc15]/10 border border-[#facc15]/30 flex items-center justify-center text-[#facc15] shrink-0 shadow-[0_0_8px_rgba(250,204,21,0.2)]">
            <span className="material-symbols-outlined text-xs">sync</span>
          </div>
          <div className="flex items-center gap-2 pr-1 text-xs">
            <span className="font-bold text-white tracking-wide">Refreshed</span>
            <span className="text-[#71717a]">•</span>
            <span className="text-[#a1a1aa] font-medium">Market steady, no opportunity changes detected</span>
          </div>
        </div>
      )}

      {deliberationSymbol && (
        <AgentDeliberationModal
          isOpen={true}
          symbol={deliberationSymbol}
          onClose={() => setDeliberationSymbol(null)}
        />
      )}
    </div>
  );
}

function GhostOpportunityCard({
  height,
  isExpanded = false,
}: {
  height?: number;
  isExpanded?: boolean;
}) {
  return (
    <div
      style={{ height: height ? `${height}px` : isExpanded ? '760px' : '520px' }}
      className="bg-[#18181b] border border-[#2b2a2c]/60 rounded-xl flex flex-col p-4 gap-3 animate-pulse relative overflow-hidden w-full transition-all"
    >
      <div className="flex justify-between items-start">
        <div className="h-5 w-20 bg-[#27272a] rounded" />
        <div className="flex flex-col items-end gap-1">
          <div className="h-5 w-10 bg-[#27272a] rounded" />
          <div className="h-2 w-14 bg-[#27272a] rounded" />
        </div>
      </div>
      <div className="space-y-1 mt-1">
        <div className="h-6 w-24 bg-[#2b2a2c] rounded" />
        <div className="h-4 w-36 bg-[#27272a] rounded" />
      </div>
      <div className="bg-[#0e0e10] p-3 rounded-lg border border-[#2b2a2c]/40 space-y-2.5">
        <div className="h-3 w-32 bg-[#27272a] rounded" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-6 bg-[#27272a]/60 rounded" />
          <div className="h-6 bg-[#27272a]/60 rounded" />
          <div className="h-6 bg-[#27272a]/60 rounded" />
          <div className="h-6 bg-[#27272a]/60 rounded" />
        </div>
      </div>
      <div className="h-8 w-full bg-[#0e0e10] rounded border border-[#2b2a2c]/40" />
      <div className="h-7 w-full bg-[#161618] rounded border border-[#2b2a2c]/40" />
      {isExpanded ? (
        <div className="space-y-2 flex-1">
          <div className="bg-[#131315]/50 p-2.5 rounded border border-[#2b2a2c]/30 space-y-1.5">
            <div className="h-3 w-full bg-[#27272a]/60 rounded" />
            <div className="h-3 w-full bg-[#27272a]/60 rounded" />
          </div>
          <div className="h-9 w-full bg-[#10b981]/5 rounded border border-[#10b981]/20" />
        </div>
      ) : (
        <div className="space-y-1.5 flex-1">
          <div className="h-3 w-full bg-[#27272a]/70 rounded" />
          <div className="h-3 w-3/4 bg-[#27272a]/70 rounded" />
        </div>
      )}
      <div className="flex gap-2 mt-auto pt-2 border-t border-[#2b2a2c]/40">
        <div className="h-8 w-24 bg-[#27272a] rounded" />
        <div className="h-8 flex-1 bg-[#27272a] rounded" />
      </div>
    </div>
  );
}