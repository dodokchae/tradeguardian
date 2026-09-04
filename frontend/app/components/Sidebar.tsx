'use client';

import React, { useState, useEffect } from 'react';

export interface SidebarProps {
  activeTab?: 'dashboard' | 'analysis' | 'ai_opportunity' | 'positions' | 'settings';
  onNavigate?: (tab: 'dashboard' | 'analysis' | 'ai_opportunity' | 'positions' | 'settings') => void;
  equity?: string | null;
  buyingPower?: string | null;
  openPositions?: number | null;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onNavigate, equity: equityProp, buyingPower: buyingPowerProp, openPositions: openPositionsProp }) => {
  // Internal state for self-fetching when props are not provided
  const [internalEquity, setInternalEquity] = useState<string | null>(null);
  const [internalBuyingPower, setInternalBuyingPower] = useState<string | null>(null);
  const [internalOpenPositions, setInternalOpenPositions] = useState<number | null>(null);

  // Self-fetch account data when props aren't supplied
  useEffect(() => {
    // If parent is already providing data, skip internal fetching
    if (equityProp != null) return;

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
    async function fetchAccount() {
      try {
        const [accRes, portRes] = await Promise.all([
          fetch(`${backendUrl}/account/`),
          fetch(`${backendUrl}/portfolio/`),
        ]);
        if (accRes.ok) {
          const accData = await accRes.json();
          setInternalEquity(accData.equity);
          setInternalBuyingPower(accData.buying_power);
        }
        if (portRes.ok) {
          const portData = await portRes.json();
          setInternalOpenPositions(Array.isArray(portData.positions) ? portData.positions.length : 0);
        }
      } catch {
        // Silently fail — show shimmer
      }
    }
    fetchAccount();
    const interval = setInterval(fetchAccount, 30000);

    const handleAccountUpdate = () => {
      fetchAccount();
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
  }, [equityProp]);

  // Use props if provided, otherwise fall back to internal state
  const equity = equityProp ?? internalEquity;
  const buyingPower = buyingPowerProp ?? internalBuyingPower;
  const openPositions = openPositionsProp ?? internalOpenPositions;

  const formatDollar = (val: string | null | undefined) => {
    if (val == null) return null;
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState<boolean>(false);

  useEffect(() => {
    const handleOpenDrawer = () => setIsMobileDrawerOpen(true);
    const handleCloseDrawer = () => setIsMobileDrawerOpen(false);
    if (typeof window !== 'undefined') {
      window.addEventListener('tradeguardian:open_mobile_drawer', handleOpenDrawer);
      window.addEventListener('tradeguardian:close_mobile_drawer', handleCloseDrawer);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('tradeguardian:open_mobile_drawer', handleOpenDrawer);
        window.removeEventListener('tradeguardian:close_mobile_drawer', handleCloseDrawer);
      }
    };
  }, []);

  const navItems: Array<{
    id: 'dashboard' | 'analysis' | 'ai_opportunity' | 'positions' | 'settings';
    label: string;
    mobileLabel: string;
    icon: string;
    badge?: { text: string; color: string };
  }> = [
    { id: 'dashboard', label: 'Dashboard', mobileLabel: 'Dashboard', icon: 'space_dashboard' },
    { id: 'analysis', label: 'Trade Analysis', mobileLabel: 'Analysis', icon: 'query_stats' },
    { id: 'ai_opportunity', label: 'AI Opportunities', mobileLabel: 'AI Opps', icon: 'auto_awesome', badge: { text: 'ALPHA', color: 'purple' } },
    { id: 'positions', label: 'Position Manager', mobileLabel: 'Positions', icon: 'monitoring', badge: { text: 'P&L', color: 'emerald' } },
    { id: 'settings', label: 'Settings', mobileLabel: 'Settings', icon: 'settings' },
  ];

  const handleNavClick = (tab: 'dashboard' | 'analysis' | 'ai_opportunity' | 'positions' | 'settings') => {
    setIsMobileDrawerOpen(false);
    onNavigate?.(tab);
  };

  const renderNavContent = () => (
    <>
      {/* Brand Header */}
      <div className="p-4 flex items-center justify-between border-b border-[#2b2a2c]/50">
        <div className="flex items-center gap-3">
          <img
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuBaJuoD2zc70ThZz24wu4V2g-CLlJn-zsbDIwcryDpqKYmntpN7nEy_j8URp21iJYwlAiQX33qaquMQ2GeNKJBTB9DDIoMOkkTtuuDTxOHEejpMvsj0FirC-Hgp61O-ZiquIStJx9O2mecX6HfP9vCiitpRe_WW3DhStgcJHMJDcFW4nime8CM2Q6MUFN95xaOJoXqkPjY5Tv4gTIqHmzyqDQO64J7GpubjiAZ9VgMHA0awrxyzgBEFW54ngltlYMbTEw"
            alt="Alpaca Logo"
            className="w-8 h-8 object-contain rounded-full"
          />
          <div>
            <div className="font-bold text-[#e4e4e7]">Alpaca</div>
            <div className="text-[10px] text-[#a1a1aa]">TradeGuardian AI</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsMobileDrawerOpen(false)}
          className="lg:hidden p-1.5 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#27272a] transition-colors"
          title="Close Navigation"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto custom-scrollbar">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <li key={item.id} className="px-3">
                <button
                  type="button"
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-left cursor-pointer ${
                    isActive
                      ? 'bg-[#facc15]/10 border-l-2 border-[#facc15] text-[#facc15]'
                      : 'text-[#a1a1aa] hover:text-[#e4e4e7] hover:bg-[#1c1b1d]'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]" style={{ fontSize: '18px' }}>
                    {item.icon}
                  </span>
                  <span className="font-medium text-sm">{item.label}</span>
                  {item.badge && (
                    <span
                      className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                        item.badge.color === 'purple'
                          ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      }`}
                    >
                      {item.badge.text}
                    </span>
                  )}
                  {isActive && !item.badge && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#facc15] animate-pulse" />
                  )}
                </button>
              </li>
            );
          })}

          <li className="my-4 border-t border-[#2b2a2c]/50 mx-4" />

          {/* Institutional Status Badge */}
          <li className="px-4 py-2">
            <div className="bg-[#0e0e10] p-3 rounded-xl border border-[#2b2a2c]/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider">FastMCP Swarm</span>
                <span className="flex items-center gap-1 text-[9px] text-emerald-400 font-mono font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  ONLINE
                </span>
              </div>
              <div className="text-[11px] text-[#71717a] leading-tight">
                4 Autonomous Agents certified for institutional risk enforcement.
              </div>
            </div>
          </li>

          <li className="my-2 border-t border-[#2b2a2c]/50 mx-4" />
        </ul>

        {/* Account Info */}
        <div className="px-6 py-4">
          <h3 className="text-[10px] font-bold text-[#a1a1aa] mb-4 uppercase tracking-widest flex items-center justify-between">
            <span>ACCOUNT OVERVIEW</span>
            <span className="text-[9px] text-emerald-400 font-mono">PAPER</span>
          </h3>
          <div className="space-y-4">
            <div>
              <div className="text-xs text-[#a1a1aa] mb-1">Total Equity</div>
              {formatDollar(equity) ? (
                <div className="text-xl font-bold font-mono text-[#e4e4e7]">{formatDollar(equity)}</div>
              ) : (
                <div className="h-7 w-36 bg-[#27272a] rounded animate-pulse" />
              )}
            </div>
            <div>
              <div className="text-xs text-[#a1a1aa] mb-1">Buying Power</div>
              {formatDollar(buyingPower) ? (
                <div className="text-xl font-bold font-mono text-[#e4e4e7]">{formatDollar(buyingPower)}</div>
              ) : (
                <div className="h-7 w-36 bg-[#27272a] rounded animate-pulse" />
              )}
            </div>
            <div>
              <div className="text-xs text-[#a1a1aa] mb-1">Open Positions</div>
              {openPositions != null ? (
                <div className="text-[15px] font-bold font-mono text-[#e4e4e7]">{openPositions} Holdings</div>
              ) : (
                <div className="h-5 w-8 bg-[#27272a] rounded animate-pulse" />
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Footer Info */}
      <div className="p-4 border-t border-[#2b2a2c] mt-auto">
        <div className="flex items-center justify-between text-xs text-[#71717a]">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Alpaca v2 Feed
          </span>
          <span className="font-mono text-[10px]">v3.2.0</span>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* 1. Desktop Persistent Sidebar (>= 1024px) */}
      <aside
        className="w-64 border-r border-[#2b2a2c] bg-[#131315] hidden lg:flex flex-col shrink-0 custom-scrollbar h-full"
        style={{ width: '256px' }}
      >
        {renderNavContent()}
      </aside>

      {/* 2. Mobile Slide-Over Drawer (< 1024px) */}
      {isMobileDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileDrawerOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="relative w-72 max-w-[85vw] bg-[#131315] border-r border-[#2b2a2c] flex flex-col h-full z-10 shadow-2xl animate-in slide-in-from-left duration-200">
            {renderNavContent()}
          </div>
        </div>
      )}

      {/* 3. Mobile / Tablet Fixed Bottom Navigation Bar (< 1024px) */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed bottom-0 inset-x-0 bg-[#131315]/95 backdrop-blur-lg border-t border-[#2b2a2c] flex items-center justify-around py-1.5 px-2 z-40 lg:hidden shadow-[0_-4px_20px_rgba(0,0,0,0.6)]"
      >
        {navItems.slice(0, 4).map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              className={`flex-1 flex flex-col items-center justify-center py-1 px-1 rounded-lg transition-all cursor-pointer ${
                isActive ? 'text-[#facc15]' : 'text-[#71717a] hover:text-[#e4e4e7]'
              }`}
            >
              <span
                className={`material-symbols-outlined text-xl transition-transform ${
                  isActive ? 'scale-110' : ''
                }`}
              >
                {item.icon}
              </span>
              <span className={`text-[10px] mt-0.5 tracking-tight font-medium ${isActive ? 'font-bold' : ''}`}>
                {item.mobileLabel}
              </span>
              {isActive && <span className="w-1 h-1 rounded-full bg-[#facc15] mt-0.5" />}
            </button>
          );
        })}

        {/* 5th Button: Drawer & Account Trigger */}
        <button
          type="button"
          onClick={() => setIsMobileDrawerOpen(!isMobileDrawerOpen)}
          className={`flex-1 flex flex-col items-center justify-center py-1 px-1 rounded-lg transition-all cursor-pointer ${
            isMobileDrawerOpen ? 'text-[#facc15]' : 'text-[#71717a] hover:text-[#e4e4e7]'
          }`}
        >
          <span className="material-symbols-outlined text-xl">
            {isMobileDrawerOpen ? 'close' : 'menu'}
          </span>
          <span className="text-[10px] mt-0.5 tracking-tight font-medium">
            Account
          </span>
        </button>
      </nav>
    </>
  );
};

export default Sidebar;