'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Sidebar } from '../components/Sidebar';
import { HoldingDetailModal } from '../components/HoldingDetailModal';
import { ManagedPositionItem, McpStatusResponse } from '../types/trade';

interface Props {
  onNavigate: (tab: 'dashboard' | 'analysis' | 'ai_opportunity' | 'positions' | 'settings') => void;
  isActive?: boolean;
}

const KNOWN_CRYPTO_SYMBOLS = new Set([
  'BTC', 'ETH', 'SOL', 'DOGE', 'AVAX', 'LINK', 'UNI', 'ADA', 'DOT',
  'NEAR', 'MATIC', 'POL', 'XRP', 'LTC', 'BCH', 'ATOM', 'XLM', 'ALGO',
  'FIL', 'ICP', 'AAVE', 'SHIB', 'PEPE', 'SUI', 'APT', 'RENDER', 'FET'
]);

const isCryptoPosition = (pos: ManagedPositionItem): boolean => {
  if (pos.is_crypto) return true;
  if (pos.asset_class === 'crypto') return true;
  const s = (pos.symbol || '').toUpperCase().trim();
  if (s.includes('/')) return true;
  if (KNOWN_CRYPTO_SYMBOLS.has(s)) return true;
  if (s.endsWith('USD') && KNOWN_CRYPTO_SYMBOLS.has(s.slice(0, -3))) return true;
  if (s.endsWith('USDT') && KNOWN_CRYPTO_SYMBOLS.has(s.slice(0, -4))) return true;
  return false;
};

export const PositionsManagerPage: React.FC<Props> = ({ onNavigate, isActive = true }) => {
  const [positions, setPositions] = useState<ManagedPositionItem[]>([]);
  const [selectedHolding, setSelectedHolding] = useState<ManagedPositionItem | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [totalPl, setTotalPl] = useState<number>(0);
  const [autoExecute, setAutoExecute] = useState<boolean>(false);
  const [isManaging, setIsManaging] = useState<boolean>(false);
  const autoExecuteRef = React.useRef(autoExecute);
  autoExecuteRef.current = autoExecute;
  const isManagingRef = React.useRef(isManaging);
  isManagingRef.current = isManaging;

  const [mcpStatus, setMcpStatus] = useState<McpStatusResponse | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [executedOrders, setExecutedOrders] = useState<any[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string>('');
  const [isClosingSymbol, setIsClosingSymbol] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsSinceSync, setSecondsSinceSync] = useState<number>(0);
  const [priceFlashes, setPriceFlashes] = useState<Record<string, 'up' | 'down'>>({});
  const prevPricesRef = React.useRef<Record<string, number>>({});
  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [highlightTarget, setHighlightTarget] = useState<{
    symbol: string;
    orderId?: string;
    isFading: boolean;
  } | null>(null);
  const highlightTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const fadeTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const recentlyClosedSymbolsRef = React.useRef<Set<string>>(new Set());

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  const triggerOrderHighlight = useCallback((symbol: string, orderId?: string) => {
    if (!symbol && !orderId) return;
    const cleanSym = (symbol || '').toUpperCase().trim();

    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);

    setHighlightTarget({
      symbol: cleanSym,
      orderId: orderId || undefined,
      isFading: false,
    });

    fadeTimerRef.current = setTimeout(() => {
      setHighlightTarget((prev) => (prev ? { ...prev, isFading: true } : null));
    }, 3500);

    highlightTimerRef.current = setTimeout(() => {
      setHighlightTarget(null);
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('tradeguardian:highlight_target');
      }
    }, 4500);

    // Multi-attempt scroll into view as DOM and table rows hydrate
    const attemptScroll = () => {
      if (typeof document === 'undefined') return false;
      const strippedSym = cleanSym.replace('/', '');
      const el =
        (orderId ? document.querySelector(`[data-order-id="${orderId}"]`) : null) ||
        (orderId && orderId.length >= 8 ? document.querySelector(`[data-order-id^="${orderId.slice(0, 8)}"]`) : null) ||
        document.querySelector(`[data-order-highlighted="true"]`) ||
        (cleanSym ? document.querySelector(`[data-position-symbol="${cleanSym}"]`) : null) ||
        (strippedSym ? document.querySelector(`[data-position-symbol="${strippedSym}"]`) : null) ||
        (cleanSym ? document.querySelector(`[data-order-symbol="${cleanSym}"]`) : null) ||
        (strippedSym ? document.querySelector(`[data-order-symbol="${strippedSym}"]`) : null);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
      return false;
    };

    setTimeout(attemptScroll, 120);
    setTimeout(attemptScroll, 450);
    setTimeout(attemptScroll, 1100);
  }, []);

  const handleToggleAutoExecute = (checked: boolean) => {
    setAutoExecute(checked);
    autoExecuteRef.current = checked;
    if (typeof window !== 'undefined') {
      localStorage.setItem('tradeguardian:auto_exit_enabled', String(checked));
    }
  };

  const fetchPositions = useCallback(async (isManual = false) => {
    try {
      if (isManual) setLoading(true);
      const res = await fetch(`${backendUrl}/positions/managed?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const rawList: ManagedPositionItem[] = Array.isArray(data.positions) ? data.positions : [];
        const posList: ManagedPositionItem[] = rawList.filter((p) => {
          const s = (p.symbol || '').toUpperCase().trim();
          return !recentlyClosedSymbolsRef.current.has(s) && !recentlyClosedSymbolsRef.current.has(s.replace('/', ''));
        });
        
        // Detect price changes and trigger subtle visual tick flashes
        const newFlashes: Record<string, 'up' | 'down'> = {};
        posList.forEach((p) => {
          const sym = p.symbol;
          const curr = Number(p.current_price || 0);
          const prev = prevPricesRef.current[sym];
          if (prev !== undefined && curr !== prev && curr > 0) {
            newFlashes[sym] = curr > prev ? 'up' : 'down';
          }
          prevPricesRef.current[sym] = curr;
        });

        if (Object.keys(newFlashes).length > 0) {
          setPriceFlashes((prev) => ({ ...prev, ...newFlashes }));
          setTimeout(() => {
            setPriceFlashes((prev) => {
              const next = { ...prev };
              Object.keys(newFlashes).forEach((k) => delete next[k]);
              return next;
            });
          }, 1500);
        }

        setPositions(posList);
        setTotalPl(Number(data.total_unrealized_pl || 0));
        setLastUpdated(new Date());
        setSecondsSinceSync(0);

        // Instant Auto-Exit Execution: If Auto-Exit Protection is ON and any position breached TP or SL policy, execute exit immediately
        if (autoExecuteRef.current && !isManagingRef.current) {
          const hasBreach = posList.some(
            (p) => p.recommendation === 'TAKE_PROFIT' || p.recommendation === 'STOP_LOSS' || p.recommendation === 'EXPIRATION_GUARD'
          );
          if (hasBreach) {
            handleRunManagerCycle(true);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load positions:', err);
    } finally {
      if (isManual) setLoading(false);
    }
  }, [backendUrl]);

  const fetchMcpStatus = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl}/mcp/status?_t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setMcpStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch MCP status:', err);
    }
  }, [backendUrl]);

  const fetchOrderHistory = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl}/trade/orders?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      });
      if (res.ok) {
        const data = await res.json();
        setExecutedOrders(Array.isArray(data.recorded_orders) ? data.recorded_orders : []);
        if (data.account_id) {
          setActiveAccountId(data.account_id);
        }
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error('Failed to fetch order history:', err);
    }
  }, [backendUrl]);

  const handleRefreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled([
      fetchPositions(true),
      fetchOrderHistory(),
      fetchMcpStatus(),
    ]);
    setLoading(false);
  }, [fetchPositions, fetchOrderHistory, fetchMcpStatus]);

  // Real-time ticker counter
  useEffect(() => {
    const ticker = setInterval(() => {
      setSecondsSinceSync((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(ticker);
  }, []);

  // Real-time synchronization: continuous 2.0s fast streaming polling when active + zero-latency event & focus triggers
  useEffect(() => {
    setIsMounted(true);
    setLastUpdated(new Date());
    setSecondsSinceSync(0);

    try {
      const stored = localStorage.getItem('tradeguardian:auto_exit_enabled');
      if (stored !== null) {
        const val = stored === 'true';
        setAutoExecute(val);
        autoExecuteRef.current = val;
      } else {
        const settingsRaw = localStorage.getItem('tradeguardian:settings');
        if (settingsRaw) {
          const s = JSON.parse(settingsRaw);
          if (typeof s.autoExecuteExits === 'boolean') {
            setAutoExecute(s.autoExecuteExits);
            autoExecuteRef.current = s.autoExecuteExits;
          }
        }
      }
    } catch {}

    // Initial fetch
    handleRefreshAll();

    // 2.0s real-time fast polling stream for live position marks & audit trail
    const interval = setInterval(() => {
      if (isActive) {
        fetchOrderHistory();
        fetchPositions();
      }
    }, 2000);

    // Instant update whenever an order is submitted, closed, or updated anywhere in the app
    const handleAccountUpdate = () => {
      fetchPositions();
      fetchOrderHistory();
      fetchMcpStatus();
    };

    const handleFocus = () => {
      if (isActive) {
        fetchPositions();
        fetchOrderHistory();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('tradeguardian:account_updated', handleAccountUpdate);
      window.addEventListener('focus', handleFocus);
    }

    return () => {
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('tradeguardian:account_updated', handleAccountUpdate);
        window.removeEventListener('focus', handleFocus);
      }
    };
  }, [fetchPositions, fetchOrderHistory, fetchMcpStatus, handleRefreshAll, isActive]);

  // Dedicated persistent listener for instant highlight events
  useEffect(() => {
    const handleHighlightEvent = (e: any) => {
      const detail = e?.detail;
      if (detail && (detail.symbol || detail.orderId)) {
        triggerOrderHighlight(detail.symbol, detail.orderId);
        handleRefreshAll();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('tradeguardian:highlight_order', handleHighlightEvent);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('tradeguardian:highlight_order', handleHighlightEvent);
      }
    };
  }, [triggerOrderHighlight, handleRefreshAll]);

  // Check stored highlight target upon tab navigation/activation
  useEffect(() => {
    if (!isActive) return;

    try {
      const stored = sessionStorage.getItem('tradeguardian:highlight_target');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && (Date.now() - (parsed.timestamp || 0)) < 20000) {
          triggerOrderHighlight(parsed.symbol, parsed.orderId);
          handleRefreshAll();
        } else {
          sessionStorage.removeItem('tradeguardian:highlight_target');
        }
      }
    } catch {}
  }, [isActive, triggerOrderHighlight, handleRefreshAll]);

  const handleRunManagerCycle = async (overrideAutoExecute?: boolean) => {
    const shouldExecute = overrideAutoExecute !== undefined ? overrideAutoExecute : autoExecuteRef.current;
    try {
      setIsManaging(true);
      isManagingRef.current = true;
      setActionMessage(null);
      const res = await fetch(`${backendUrl}/positions/manage-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_execute: shouldExecute }),
      });
      if (res.ok) {
        const data = await res.json();
        const executedCount = data.actions_taken?.length || 0;
        if (executedCount > 0) {
          setActionMessage(
            `Autonomous execution complete: ${executedCount} position(s) closed per Guardian policies!`
          );
        } else {
          setActionMessage(
            `Autonomous scan complete. Evaluated ${data.total_positions} positions. All holdings within safety parameters.`
          );
        }
        await handleRefreshAll();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('tradeguardian:account_updated'));
        }
      }
    } catch (err: any) {
      setActionMessage(`Error running position manager: ${err.message}`);
    } finally {
      setIsManaging(false);
      isManagingRef.current = false;
    }
  };

  const handleClosePosition = async (symbol: string) => {
    const cleanSym = (symbol || '').toUpperCase().trim();
    const strippedSym = cleanSym.replace('/', '');
    try {
      setIsClosingSymbol(symbol);
      setActionMessage(null);
      // Immediately track in recentlyClosedSymbolsRef to prevent ghost resurrection while Alpaca backend processes
      recentlyClosedSymbolsRef.current.add(cleanSym);
      recentlyClosedSymbolsRef.current.add(strippedSym);
      // Immediately remove closed position from local state
      setPositions((prev) => prev.filter((p) => {
        const s = (p.symbol || '').toUpperCase().trim();
        return s !== cleanSym && s !== strippedSym;
      }));

      const res = await fetch(`${backendUrl}/positions/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      if (res.ok) {
        const data = await res.json();
        setActionMessage(`Successfully closed ${symbol} via ${data.engine || 'Alpaca SDK'}.`);
        await handleRefreshAll();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('tradeguardian:account_updated'));
        }
      } else {
        const errData = await res.json();
        const errDetail = String(errData.detail || 'Unknown error');
        if (errDetail.toLowerCase().includes('not found') || errDetail.toLowerCase().includes('does not exist')) {
          setActionMessage(`Position ${symbol} is already closed on Alpaca.`);
          await handleRefreshAll();
        } else {
          // Re-allow position if genuine failure
          recentlyClosedSymbolsRef.current.delete(cleanSym);
          recentlyClosedSymbolsRef.current.delete(strippedSym);
          setActionMessage(`Failed to close ${symbol}: ${errDetail}`);
          await handleRefreshAll();
        }
      }
    } catch (err: any) {
      recentlyClosedSymbolsRef.current.delete(cleanSym);
      recentlyClosedSymbolsRef.current.delete(strippedSym);
      setActionMessage(`Error closing position: ${err.message}`);
      await handleRefreshAll();
    } finally {
      setIsClosingSymbol(null);
      // Release from blocklist after 12s when Alpaca replication is complete
      setTimeout(() => {
        recentlyClosedSymbolsRef.current.delete(cleanSym);
        recentlyClosedSymbolsRef.current.delete(strippedSym);
      }, 12000);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!orderId) return;
    try {
      setCancellingOrderId(orderId);
      setActionMessage(null);
      const res = await fetch(`${backendUrl}/trade/cancel/${orderId}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage(`Successfully canceled order ${orderId.slice(0, 8)}... via ${data.cancellation_engine || 'Alpaca MCP'}.`);
        await handleRefreshAll();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('tradeguardian:account_updated'));
        }
      } else {
        setActionMessage(`Failed to cancel order: ${data.detail || 'Unknown error'}`);
      }
    } catch (err: any) {
      setActionMessage(`Error cancelling order: ${err.message}`);
    } finally {
      setCancellingOrderId(null);
    }
  };

  // Derive pending orders awaiting execution
  const pendingOrders = useMemo(() => {
    return executedOrders.filter((ord) => {
      const st = (ord.status || '').toLowerCase();
      return !['filled', 'canceled', 'cancelled', 'expired', 'rejected'].includes(st);
    });
  }, [executedOrders]);

  // Keep selected holding reactive to real-time 2.5s polling updates
  const activeHolding = useMemo(() => {
    if (!selectedHolding) return null;
    const found = positions.find((p) => (p.symbol || p.asset_id) === (selectedHolding.symbol || selectedHolding.asset_id));
    return found || selectedHolding;
  }, [positions, selectedHolding]);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#131315] text-[#e4e4e7] font-sans antialiased">
      <div className="flex flex-1 overflow-hidden h-full">
        {/* Sidebar */}
        <Sidebar activeTab="positions" onNavigate={onNavigate} />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col h-full bg-[#131315] min-w-0 overflow-y-auto custom-scrollbar pb-20 lg:pb-6">
          {/* Header */}
          <header className="flex items-center justify-between px-3 sm:px-6 border-b border-[#2b2a2c] shrink-0 bg-[#131315] py-2.5 sm:py-3.5 min-w-0 flex-wrap gap-2.5">
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
              <div className="w-8 h-8 rounded-lg bg-[#10b981]/15 border border-[#10b981]/30 flex items-center justify-center text-[#10b981]">
                <span className="material-symbols-outlined text-lg">monitoring</span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-sm sm:text-lg font-bold text-[#e4e4e7]">Position & P&L Manager</h1>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#10b981]/15 border border-[#10b981]/40 text-[#10b981]">
                    Autonomous Risk Engine
                  </span>
                  <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#10b981]/10 border border-[#10b981]/30 text-[#10b981] text-[10px] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                    <span>Real-Time Stream Active</span>
                    <span className="text-[#a1a1aa] font-mono text-[9px] ml-1">
                      • {secondsSinceSync <= 1 ? 'Ticking now' : `${secondsSinceSync}s ago`}
                      {lastUpdated && ` (${lastUpdated.toLocaleTimeString()})`}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-[#a1a1aa] mt-0.5 hidden sm:block">
                  Live Alpaca options tracking, P&L evaluation, Take-Profit targets (+50%), and Stop-Loss guardrails (-25%).
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {/* MCP Status Badge */}
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#18181b] border border-[#2b2a2c] text-xs">
                <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
                <span className="font-semibold text-[#e4e4e7]">Alpaca MCP:</span>
                <span className="text-[#10b981] font-bold">
                  {mcpStatus?.total_tools ? `${mcpStatus.total_tools} Tools Active` : 'Connected'}
                </span>
              </div>

              {/* Refresh All Button */}
              <button
                type="button"
                onClick={handleRefreshAll}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1c1b1d] border border-[#2b2a2c] hover:border-[#facc15] hover:bg-[#27272a] text-xs font-semibold text-[#a1a1aa] hover:text-[#facc15] transition-all cursor-pointer"
                title="Refresh positions and audit trail now"
              >
                <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>
                  refresh
                </span>
                <span>Refresh</span>
              </button>
            </div>
          </header>

          {/* Action notification */}
          {actionMessage && (
            <div className="mx-3 sm:mx-6 mt-4 p-3 rounded-lg bg-[#18181b] border border-[#facc15]/40 text-xs text-[#facc15] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">info</span>
                <span>{actionMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setActionMessage(null)}
                className="text-[#a1a1aa] hover:text-[#e4e4e7] text-xs"
              >
                ✕
              </button>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-6 pb-2">
            {/* Unrealized P&L */}
            <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-4 shadow-sm">
              <div className="text-[10px] uppercase font-bold text-[#a1a1aa] tracking-wider">
                Total Unrealized P&L
              </div>
              <div
                className={`text-2xl font-black mt-1 ${
                  totalPl >= 0 ? 'text-[#10b981]' : 'text-rose-400'
                }`}
              >
                ${totalPl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-[11px] text-[#a1a1aa] mt-1 flex items-center gap-1">
                <span>Active portfolio mark-to-market</span>
              </div>
            </div>

            {/* Total Positions */}
            <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-4 shadow-sm">
              <div className="text-[10px] uppercase font-bold text-[#a1a1aa] tracking-wider">
                Open Positions
              </div>
              <div className="text-2xl font-black text-[#e4e4e7] mt-1 flex items-baseline gap-2">
                <span>{positions.length}</span>
                {pendingOrders.length > 0 && (
                  <span className="text-xs font-semibold text-[#facc15] px-2 py-0.5 rounded bg-[#facc15]/10 border border-[#facc15]/30">
                    +{pendingOrders.length} pending
                  </span>
                )}
              </div>
              <div className="text-[11px] text-[#a1a1aa] mt-1">
                {positions.filter((p) => p.is_option).length} Options | {positions.filter((p) => !p.is_option).length} Equities
              </div>
            </div>

            {/* Autonomous Policies */}
            <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-[#a1a1aa] tracking-wider">
                  Guardian Policies
                </span>
                <span className="text-[9px] text-[#71717a] font-mono">Options / Equities</span>
              </div>
              <div className="text-xs font-semibold text-[#facc15] mt-1.5 space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#a1a1aa]">Take-Profit:</span>
                  <span className="text-[#10b981] font-bold">+50% <span className="text-[10px] text-[#a1a1aa] font-normal">(+20% Eq)</span></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#a1a1aa]">Stop-Loss Guard:</span>
                  <span className="text-rose-400 font-bold">-25% <span className="text-[10px] text-[#a1a1aa] font-normal">(-10% Eq)</span></span>
                </div>
              </div>
            </div>

            {/* Autonomous Controller */}
            <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-4 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-[#a1a1aa] tracking-wider">
                    Auto-Exit Protection
                  </span>
                  <span suppressHydrationWarning className={`text-[10px] font-semibold flex items-center gap-1 mt-0.5 ${autoExecute ? 'text-[#10b981]' : 'text-[#71717a]'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${autoExecute ? 'bg-[#10b981] animate-pulse' : 'bg-[#71717a]'}`}></span>
                    {autoExecute ? 'Armed & Auto-Closing' : 'Advisory (Manual Only)'}
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer" title={autoExecute ? "Auto-Exit is Armed: Positions exceeding TP/SL will automatically close" : "Auto-Exit is Off: Positions will only be flagged for manual review"}>
                  <input
                    type="checkbox"
                    checked={autoExecute}
                    onChange={(e) => handleToggleAutoExecute(e.target.checked)}
                    className="sr-only peer"
                    suppressHydrationWarning
                  />
                  <div className="w-8 h-4 bg-[#27272a] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#10b981]"></div>
                </label>
              </div>

              <button
                type="button"
                onClick={() => handleRunManagerCycle()}
                disabled={isManaging}
                className="mt-2 w-full py-1.5 rounded-md bg-[#facc15] hover:bg-[#eab308] text-[#131315] font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-50"
              >
                {isManaging ? (
                  <>
                    <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                    <span>Auditing...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">shield</span>
                    <span>Run Guardian Scan</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Active Positions Table Panel */}
          <div className="p-6">
            <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl overflow-hidden shadow-xl">
              <div className="px-5 py-4 border-b border-[#2b2a2c] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="font-bold text-sm text-[#e4e4e7]">Active Holdings</h3>
                  <span className="text-xs text-[#a1a1aa]">({positions.length} open position{positions.length === 1 ? '' : 's'})</span>
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#10b981]/10 border border-[#10b981]/30 text-[#10b981] text-[10px] font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                    <span>LIVE HOLDINGS</span>
                  </div>
                  <span className="hidden sm:inline-flex text-[11px] text-[#a1a1aa] bg-[#27272a]/60 px-2 py-0.5 rounded border border-[#3f3f46]/40 items-center gap-1">
                    <span className="material-symbols-outlined text-xs text-[#facc15]">touch_app</span>
                    <span>Click any row to inspect live chart & details</span>
                  </span>
                </div>
                <div className="text-xs text-[#a1a1aa] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#10b981]" />
                  <span>Monitored by PositionManagerAgent</span>
                </div>
              </div>

              {/* Notice if there are orders pending execution on Alpaca */}
              {pendingOrders.length > 0 && (
                <div className="px-5 py-2.5 bg-[#facc15]/10 border-b border-[#facc15]/20 flex items-center justify-between text-xs text-[#facc15]">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-base animate-pulse">hourglass_top</span>
                    <span>
                      <strong>{pendingOrders.length} working order{pendingOrders.length === 1 ? '' : 's'} pending on Alpaca:</strong>{' '}
                      {pendingOrders.map((o) => `${o.side?.toUpperCase()} ${o.quantity}x ${o.option_symbol || o.symbol} (${o.status})`).join(', ')}
                    </span>
                  </div>
                  <span className="text-[10px] opacity-80">Syncs to holdings upon execution</span>
                </div>
              )}

              {positions.length === 0 ? (
                <div className="py-14 text-center text-[#a1a1aa] space-y-3 px-4">
                  <div className="w-12 h-12 rounded-full bg-[#27272a] mx-auto flex items-center justify-center text-[#a1a1aa]">
                    <span className="material-symbols-outlined text-2xl">account_balance_wallet</span>
                  </div>
                  <div className="text-sm font-semibold text-[#e4e4e7]">
                    {pendingOrders.length > 0 ? 'Orders Awaiting Fill' : 'No Open Positions'}
                  </div>
                  <p className="text-xs max-w-md mx-auto text-[#a1a1aa]">
                    {pendingOrders.length > 0 ? (
                      <>
                        You have <strong className="text-[#facc15]">{pendingOrders.length} active order(s)</strong> submitted to Alpaca paper account. They will automatically appear in this window with real-time Take-Profit (+50%) and Stop-Loss (-25%) guardrails once filled.
                      </>
                    ) : (
                      'No active positions currently open in Alpaca paper account. Execute an opportunity from the AI Opportunities tab or Trade Analysis desk to start live position monitoring.'
                    )}
                  </p>
                  <div className="flex items-center justify-center pt-1">
                    <button
                      type="button"
                      onClick={() => onNavigate('ai_opportunity')}
                      className="px-4 py-2 rounded-md bg-[#facc15] text-[#131315] font-bold text-xs cursor-pointer hover:bg-[#eab308] transition-all inline-flex items-center gap-1.5 shadow-sm"
                    >
                      <span>Browse AI Opportunities</span>
                      <span className="material-symbols-outlined text-xs">arrow_forward</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#2b2a2c] bg-[#141416] text-[#a1a1aa] font-bold uppercase text-[10px] tracking-wider">
                        <th className="py-3 px-4">Symbol / Contract</th>
                        <th className="py-3 px-3">Type</th>
                        <th className="py-3 px-3">Qty</th>
                        <th className="py-3 px-3">Entry Price</th>
                        <th className="py-3 px-3">Current Price</th>
                        <th className="py-3 px-3">Unrealized P&L</th>
                        <th className="py-3 px-3">DTE</th>
                        <th className="py-3 px-3">Guardian Action</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2b2a2c]/60">
                      {positions.map((pos) => {
                        const plVal = Number(pos.unrealized_pl ?? 0);
                        const isProfitable = plVal >= 0;
                        const plpcVal = Number(pos.unrealized_plpc ?? 0);
                        const entryPrice = Number(pos.avg_entry_price ?? 0);
                        const currPrice = Number(pos.current_price ?? entryPrice);
                        const qtyVal = Number(pos.qty ?? 0);
                        const isSelected = selectedHolding?.symbol === pos.symbol;
                        const isCrypto = isCryptoPosition(pos);
                        const isHighlighted = Boolean(
                          highlightTarget &&
                            (highlightTarget.symbol === (pos.symbol || '').toUpperCase() ||
                              (pos.underlying_symbol && highlightTarget.symbol === pos.underlying_symbol.toUpperCase()) ||
                              (pos.symbol && highlightTarget.symbol.replace('/', '') === (pos.symbol || '').toUpperCase().replace('/', '')))
                        );

                        return (
                          <tr
                            key={pos.symbol || pos.asset_id}
                            data-position-symbol={pos.symbol}
                            onClick={() => setSelectedHolding(pos)}
                            className={`transition-all duration-500 cursor-pointer group ${
                              isHighlighted
                                ? `bg-gradient-to-r from-amber-500/20 via-[#24242a] to-transparent ring-2 ring-amber-400/90 shadow-[0_0_28px_rgba(250,204,21,0.25)] ${
                                    highlightTarget?.isFading ? 'opacity-90' : 'animate-pulse'
                                  }`
                                : isSelected
                                ? 'bg-[#24242a] border-l-4 border-l-[#facc15]'
                                : 'hover:bg-[#202023]'
                            }`}
                            title={`Click to inspect live chart & real-time details for ${pos.symbol}`}
                          >
                            <td className="py-3 px-4 font-bold text-[#e4e4e7]">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="material-symbols-outlined text-xs text-[#71717a] group-hover:text-[#facc15] transition-colors">
                                  {isCrypto ? 'currency_bitcoin' : 'show_chart'}
                                </span>
                                <span className="font-mono">{pos.symbol}</span>
                                {isHighlighted && (
                                  <span
                                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-400 text-black font-extrabold text-[10px] uppercase tracking-wider shadow-md transition-all duration-700 ${
                                      highlightTarget?.isFading ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                                    }`}
                                  >
                                    <span className="material-symbols-outlined text-xs" style={{ fontSize: '13px' }}>
                                      shopping_bag
                                    </span>
                                    Here's your order
                                  </span>
                                )}
                                {pos.is_option ? (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#facc15]/10 text-[#facc15] border border-[#facc15]/30">
                                    OCC OPTION
                                  </span>
                                ) : isCrypto ? (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                                    CRYPTO
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="py-3 px-3 uppercase text-[11px] font-semibold text-[#a1a1aa]">
                              {pos.option_type ? `${pos.option_type} @ $${pos.strike_price}` : isCrypto ? 'Crypto Spot' : 'Equity'}
                            </td>
                            <td className="py-3 px-3 font-semibold text-[#e4e4e7]">{qtyVal}</td>
                            <td className="py-3 px-3 text-[#a1a1aa]">${entryPrice.toFixed(2)}</td>
                            <td className="py-3 px-3 font-semibold text-[#e4e4e7]">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded transition-all duration-700 ${
                                  priceFlashes[pos.symbol] === 'up'
                                    ? 'bg-[#10b981]/25 text-[#10b981] font-bold ring-1 ring-[#10b981]/50 scale-105'
                                    : priceFlashes[pos.symbol] === 'down'
                                    ? 'bg-rose-500/25 text-rose-400 font-bold ring-1 ring-rose-500/50 scale-105'
                                    : 'text-[#e4e4e7]'
                                }`}
                              >
                                ${currPrice < 1 ? currPrice.toFixed(4) : currPrice.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-3 px-3">
                              <div
                                className={`font-bold ${
                                  isProfitable ? 'text-[#10b981]' : 'text-rose-400'
                                }`}
                              >
                                {isProfitable ? '+' : ''}
                                ${plVal.toFixed(2)}
                                <span className="text-[10px] ml-1 opacity-80">
                                  ({(plpcVal * 100).toFixed(1)}%)
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-[#a1a1aa]">
                              {pos.days_to_expiration != null ? `${pos.days_to_expiration}d` : 'N/A'}
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                  pos.recommendation === 'TAKE_PROFIT'
                                    ? 'bg-[#10b981]/20 text-[#10b981] border-[#10b981]/40 animate-pulse'
                                    : pos.recommendation === 'STOP_LOSS'
                                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 animate-pulse'
                                    : pos.recommendation === 'EXPIRATION_GUARD'
                                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                                    : 'bg-[#27272a] text-[#a1a1aa] border-[#3f3f46]'
                                }`}
                              >
                                {pos.recommendation || 'HOLD'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedHolding(pos)}
                                  className="px-2 py-1 rounded bg-[#27272a] hover:bg-[#3f3f46] text-xs font-semibold text-[#a1a1aa] hover:text-[#facc15] transition-all cursor-pointer border border-[#3f3f46] flex items-center gap-1"
                                  title="Inspect Live Chart & Real-Time Details"
                                >
                                  <span className="material-symbols-outlined text-xs">analytics</span>
                                  <span>Inspect</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleClosePosition(pos.symbol)}
                                  disabled={isClosingSymbol === pos.symbol}
                                  className="px-2.5 py-1 rounded bg-[#27272a] hover:bg-rose-600 hover:text-white text-xs font-semibold text-[#e4e4e7] transition-all cursor-pointer border border-[#3f3f46] disabled:opacity-50"
                                >
                                  {isClosingSymbol === pos.symbol ? 'Closing...' : 'Close Position'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Alpaca Order Audit Trail */}
            <div className="mt-6 bg-[#18181b] border border-[#2b2a2c] rounded-xl overflow-hidden shadow-xl">
              <div className="px-5 py-3.5 border-b border-[#2b2a2c] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[#facc15] text-base">receipt_long</span>
                  <h3 className="font-bold text-sm text-[#e4e4e7]">Alpaca Order Audit Trail</h3>
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#10b981]/10 border border-[#10b981]/30 text-[#10b981] text-[10px] font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
                    <span>REAL-TIME AUDIT STREAM</span>
                  </div>
                  {activeAccountId && (
                    <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#6366f1]/10 border border-[#6366f1]/30 text-[#a5b4fc] text-[10px] font-mono font-medium">
                      <span className="text-[#818cf8]">ACCOUNT:</span>
                      <span>{activeAccountId.length > 12 ? `${activeAccountId.slice(0, 8)}...${activeAccountId.slice(-4)}` : activeAccountId}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-[#a1a1aa] font-mono" suppressHydrationWarning>
                    Last sync: {isMounted && lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
                  </span>
                  <span className="text-[10px] text-[#a1a1aa] uppercase tracking-wider font-semibold">
                    Alpaca FastMCP Verified
                  </span>
                </div>
              </div>

              {executedOrders.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#a1a1aa]">
                  No orders recorded for active Alpaca account{activeAccountId ? ` (${activeAccountId.slice(0, 8)}...)` : ''}. Submit a trade in the Trade Analysis desk or AI Opportunities to start live audit.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#2b2a2c] bg-[#141416] text-[#a1a1aa] font-bold uppercase text-[10px] tracking-wider">
                        <th className="py-2.5 px-4">Order ID</th>
                        <th className="py-2.5 px-3">Symbol / Leg</th>
                        <th className="py-2.5 px-3">Side</th>
                        <th className="py-2.5 px-3">Qty</th>
                        <th className="py-2.5 px-3">Type</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-4">Time (UTC)</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2b2a2c]/60 text-[11px]">
                      {executedOrders.map((ord) => {
                        const orderId = String(ord.order_id || ord.id || '');
                        const statusStr = String(ord.status || '').toLowerCase();
                        const isCancellable = !['filled', 'canceled', 'cancelled', 'expired', 'rejected'].includes(statusStr);
                        const isCancelling = cancellingOrderId === orderId;
                        const subTime = String(ord.submitted_at || '');
                        const isNewStatus = ['new', 'pending_new', 'accepted'].includes(statusStr);
                        const isIdMatch = Boolean(
                          highlightTarget?.orderId &&
                          orderId &&
                          (orderId === highlightTarget.orderId ||
                           (highlightTarget.orderId.length >= 8 && orderId.startsWith(highlightTarget.orderId.slice(0, 8))))
                        );
                        const isSymbolMatch = Boolean(
                          highlightTarget?.symbol &&
                          ((ord.symbol || '').toUpperCase() === highlightTarget.symbol ||
                           (ord.option_symbol || '').toUpperCase() === highlightTarget.symbol ||
                           (ord.symbol && (ord.symbol || '').toUpperCase().replace('/', '') === highlightTarget.symbol.replace('/', '')))
                        );
                        // Specifically ID-based when orderId is provided, or strictly only when order is in 'new'/'pending_new'/'accepted' status
                        const isOrderHighlighted = Boolean(
                          highlightTarget && (
                            isIdMatch ||
                            (!highlightTarget.orderId && isSymbolMatch && isNewStatus) ||
                            (isSymbolMatch && isNewStatus)
                          )
                        );

                        return (
                          <tr
                            key={orderId || `${ord.symbol}-${ord.submitted_at}`}
                            data-order-id={orderId}
                            data-order-symbol={ord.symbol}
                            data-order-highlighted={isOrderHighlighted ? 'true' : undefined}
                            className={`transition-all duration-500 ${
                              isOrderHighlighted
                                ? `bg-gradient-to-r from-amber-500/20 via-[#24242a] to-transparent ring-2 ring-amber-400/90 shadow-[0_0_24px_rgba(250,204,21,0.25)] ${
                                    highlightTarget?.isFading ? 'opacity-90' : 'animate-pulse'
                                  }`
                                : 'hover:bg-[#202023]'
                            }`}
                          >
                            <td className="py-2 px-4 font-mono text-[10px] text-[#a1a1aa]">
                              {orderId ? `${orderId.slice(0, 8)}...` : '—'}
                            </td>
                            <td className="py-2 px-3 font-semibold text-[#e4e4e7]">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span>{ord.option_symbol || ord.symbol}</span>
                                {isOrderHighlighted && (
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.2 rounded-full bg-amber-400 text-black font-extrabold text-[9px] uppercase tracking-wider shadow-md transition-all duration-700 ${
                                      highlightTarget?.isFading ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                                    }`}
                                  >
                                    <span className="material-symbols-outlined text-[11px]" style={{ fontSize: '11px' }}>
                                      shopping_bag
                                    </span>
                                    Here's your order
                                  </span>
                                )}
                                {ord.option_symbol && (
                                  <span className="text-[9px] px-1 py-0.1 rounded bg-[#facc15]/10 text-[#facc15] border border-[#facc15]/20 font-mono">
                                    OPT
                                  </span>
                                )}
                              </div>
                            </td>
                            <td
                              className={`py-2 px-3 uppercase font-bold ${
                                String(ord.side).toLowerCase().includes('sell') ? 'text-rose-400' : 'text-[#10b981]'
                              }`}
                            >
                              {String(ord.side || '').toUpperCase()}
                            </td>
                            <td className="py-2 px-3 font-semibold">{Number(ord.quantity ?? ord.qty ?? 0)}</td>
                            <td className="py-2 px-3 uppercase text-[#a1a1aa]">{String(ord.order_type ?? ord.type ?? '').toUpperCase()}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                                  statusStr === 'filled'
                                    ? 'bg-[#10b981]/15 text-[#10b981] border-[#10b981]/30'
                                    : statusStr === 'canceled' || statusStr === 'cancelled'
                                    ? 'bg-zinc-800 text-[#a1a1aa] border-zinc-700'
                                    : statusStr === 'rejected' || statusStr === 'expired'
                                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30 animate-pulse'
                                }`}
                              >
                                {statusStr.toUpperCase()}
                              </span>
                            </td>
                            <td className="py-2 px-4 text-[#a1a1aa] font-mono text-[10px]">
                              {subTime.includes('T') ? subTime.split('T')[1].slice(0, 8) : subTime.slice(11, 19) || subTime || '—'}
                            </td>
                            <td className="py-2 px-4 text-right">
                              {isCancellable ? (
                                <button
                                  type="button"
                                  onClick={() => handleCancelOrder(orderId)}
                                  disabled={isCancelling}
                                  className="px-2.5 py-1 rounded bg-rose-500/10 hover:bg-rose-600 hover:text-white border border-rose-500/30 text-rose-400 font-semibold text-[11px] transition-all cursor-pointer disabled:opacity-50 inline-flex items-center gap-1 shadow-sm"
                                  title="Cancel this placed order on Alpaca"
                                >
                                  {isCancelling ? (
                                    <>
                                      <span className="material-symbols-outlined text-[13px] animate-spin">progress_activity</span>
                                      <span>Cancelling...</span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="material-symbols-outlined text-[13px]">cancel</span>
                                      <span>Cancel</span>
                                    </>
                                  )}
                                </button>
                              ) : (
                                <span className="text-[10px] text-[#71717a] font-mono uppercase">
                                  {statusStr === 'filled' ? 'Filled' : statusStr.includes('cancel') ? 'Canceled' : '—'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Holding Live Chart & Real-Time Details Modal */}
      <HoldingDetailModal
        position={activeHolding}
        isOpen={Boolean(activeHolding)}
        onClose={() => setSelectedHolding(null)}
        onClosePosition={async (sym) => {
          await handleClosePosition(sym);
          setSelectedHolding(null);
        }}
        isClosing={isClosingSymbol === activeHolding?.symbol}
      />
    </div>
  );
};

export default PositionsManagerPage;
