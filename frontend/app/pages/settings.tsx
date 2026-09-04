'use client';

import React, { useState, useEffect } from 'react';
import { Sidebar } from '../components/Sidebar';

interface Props {
  onNavigate: (tab: 'dashboard' | 'analysis' | 'ai_opportunity' | 'positions' | 'settings') => void;
  isActive?: boolean;
}

interface GuardianSettings {
  environment: 'paper' | 'live';
  apiKey: string;
  apiSecret: string;
  maxAllocationPerTrade: number;
  maxSectorConcentration: number;
  defaultTakeProfit: number;
  defaultStopLoss: number;
  expirationGuardDte: number;
  autoExecuteExits: boolean;
  mcpEngineMode: 'fastmcp' | 'direct';
  dataFeed: 'iex' | 'sip';
  pollingRateMs: number;
  soundAlerts: boolean;
  defaultChartStyle: '8' | '1' | '3';
}

const DEFAULT_SETTINGS: GuardianSettings = {
  environment: 'paper',
  apiKey: '',
  apiSecret: '',
  maxAllocationPerTrade: 15,
  maxSectorConcentration: 25,
  defaultTakeProfit: 50,
  defaultStopLoss: 25,
  expirationGuardDte: 1,
  autoExecuteExits: true,
  mcpEngineMode: 'fastmcp',
  dataFeed: 'iex',
  pollingRateMs: 2500,
  soundAlerts: true,
  defaultChartStyle: '8',
};

interface AlpacaAccountInfo {
  id: string;
  status: string;
  currency: string;
  equity: number;
  cash: number;
  buying_power: number;
}

export const SettingsPage: React.FC<Props> = ({ onNavigate }) => {
  const [settings, setSettings] = useState<GuardianSettings>(DEFAULT_SETTINGS);
  const [showKey, setShowKey] = useState<boolean>(false);
  const [showSecret, setShowSecret] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latency?: number } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeAccount, setActiveAccount] = useState<AlpacaAccountInfo | null>(null);
  const [backendAlpacaConfig, setBackendAlpacaConfig] = useState<{
    is_configured: boolean;
    api_key_masked: string;
    base_url: string;
    paper: boolean;
  } | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  // Load persisted settings and backend Alpaca credentials on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('tradeguardian:settings');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setSettings((prev) => ({ ...prev, ...parsed }));
        } catch {
          // Keep defaults
        }
      }
    }

    const fetchConfigAndAccount = async () => {
      try {
        const confRes = await fetch(`${backendUrl}/settings/alpaca`);
        if (confRes.ok) {
          const conf = await confRes.json();
          setBackendAlpacaConfig(conf);
          if (conf.is_configured && conf.api_key_masked) {
            setSettings((prev) => ({
              ...prev,
              apiKey: prev.apiKey && !prev.apiKey.includes('••••') ? prev.apiKey : conf.api_key_masked,
              apiSecret: prev.apiSecret || '••••••••••••••••••••••••••••••••••••••••',
            }));
          }
        }

        const accRes = await fetch(`${backendUrl}/account/`);
        if (accRes.ok) {
          const acc = await accRes.json();
          if (acc && (acc.id || acc.account_id)) {
            setActiveAccount({
              id: String(acc.id || acc.account_id),
              status: String(acc.status || 'ACTIVE'),
              currency: String(acc.currency || 'USD'),
              equity: Number(acc.equity || 0),
              cash: Number(acc.cash || 0),
              buying_power: Number(acc.buying_power || 0),
            });
          }
        }
      } catch (err) {
        console.warn('Could not load backend Alpaca configuration on mount:', err);
      }
    };

    fetchConfigAndAccount();
  }, [backendUrl]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const isNewKeys =
        settings.apiKey &&
        settings.apiSecret &&
        !settings.apiKey.includes('••••') &&
        !settings.apiSecret.includes('••••');

      let updatedAccount = null;

      if (isNewKeys) {
        // Send to backend endpoint to validate, write to .env, and reinitialize Alpaca clients
        const res = await fetch(`${backendUrl}/settings/alpaca`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: settings.apiKey.trim(),
            secret_key: settings.apiSecret.trim(),
            base_url: 'https://paper-api.alpaca.markets',
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || 'Failed to update credentials on Alpaca backend.');
        }

        if (data.account) {
          updatedAccount = data.account;
          setActiveAccount(data.account);
        }
        if (data.api_key_masked) {
          setSettings((prev) => ({
            ...prev,
            apiKey: data.api_key_masked,
            apiSecret: '••••••••••••••••••••••••••••••••••••••••',
          }));
        }
      }

      // Persist client preferences to localStorage
      if (typeof window !== 'undefined') {
        const toSave = { ...settings };
        if (isNewKeys) {
          toSave.apiKey = settings.apiKey.slice(0, 5) + '••••••••' + settings.apiKey.slice(-4);
          toSave.apiSecret = '••••••••••••••••••••••••••••••••••••••••';
        }
        localStorage.setItem('tradeguardian:settings', JSON.stringify(toSave));
        window.dispatchEvent(new CustomEvent('tradeguardian:settings_updated', { detail: toSave }));
        if (updatedAccount) {
          window.dispatchEvent(new CustomEvent('tradeguardian:account_updated', { detail: updatedAccount }));
        }
      }

      setSaveSuccess(
        isNewKeys
          ? 'Credentials verified, saved to backend, and live Alpaca account switched!'
          : 'Settings & risk guardrails saved successfully!'
      );
      setTimeout(() => setSaveSuccess(null), 4500);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save settings.');
      setTimeout(() => setSaveError(null), 6000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    if (typeof window !== 'undefined') {
      localStorage.setItem('tradeguardian:settings', JSON.stringify(DEFAULT_SETTINGS));
      window.dispatchEvent(new CustomEvent('tradeguardian:settings_updated', { detail: DEFAULT_SETTINGS }));
    }
    setSaveSuccess('Configuration restored to desk defaults.');
    setTimeout(() => setSaveSuccess(null), 3000);
  };

  const testAlpacaConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const start = performance.now();

    try {
      const isNewKeys =
        settings.apiKey &&
        settings.apiSecret &&
        !settings.apiKey.includes('••••') &&
        !settings.apiSecret.includes('••••');

      let res: Response;
      if (isNewKeys) {
        // Test newly entered keys without persisting yet
        res = await fetch(`${backendUrl}/settings/alpaca/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: settings.apiKey.trim(),
            secret_key: settings.apiSecret.trim(),
            base_url: 'https://paper-api.alpaca.markets',
          }),
        });
      } else {
        // Ping active backend account
        res = await fetch(`${backendUrl}/account/`);
      }

      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        const data = await res.json();
        const accId = data.account_id || data.id || 'N/A';
        const status = (data.status || 'ACTIVE').toUpperCase();
        const equity = data.equity != null ? Number(data.equity) : null;
        const buyingPower = data.buying_power != null ? Number(data.buying_power) : null;

        setTestResult({
          success: true,
          message: `Connected successfully to Alpaca (${status}). Account ID: ${accId.slice(0, 8)}... | Equity: $${(equity ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Buying Power: $${(buyingPower ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          latency,
        });

        if (data.id || data.account_id) {
          setActiveAccount({
            id: String(accId),
            status: String(data.status || 'ACTIVE'),
            currency: String(data.currency || 'USD'),
            equity: Number(data.equity || 0),
            cash: Number(data.cash || 0),
            buying_power: Number(data.buying_power || 0),
          });
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setTestResult({
          success: false,
          message: errData.detail || `Alpaca server returned HTTP ${res.status}. Check API credentials or network connectivity.`,
          latency,
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: `Failed to ping backend API: ${err.message || 'Connection refused'}. Ensure FastAPI backend is running on port 8000.`,
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0e0e10] text-[#e4e4e7] overflow-hidden">
      {/* Sidebar */}
      <Sidebar activeTab="settings" onNavigate={onNavigate} />

      {/* Main Content Settings */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto custom-scrollbar pb-20 lg:pb-6">
        {/* Top Header */}
        <header className="px-3 sm:px-6 py-2.5 sm:py-3.5 border-b border-[#2b2a2c] bg-[#131315]/90 backdrop-blur flex items-center justify-between shrink-0 sticky top-0 z-30 flex-wrap gap-2.5">
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
            <div className="w-8 h-8 rounded-lg bg-[#facc15]/10 border border-[#facc15]/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-[#facc15] text-lg">settings</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-bold text-xs sm:text-sm text-[#e4e4e7] tracking-wide">SYSTEM SETTINGS & RISK CONTROLS</h1>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30">
                  PAPER BROKERAGE
                </span>
              </div>
              <p className="text-[10px] text-[#a1a1aa] hidden sm:block">Configure Alpaca API credentials, autonomous agent parameters, and Guardian guardrails</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {saveSuccess && (
              <span className="text-xs font-bold text-[#10b981] flex items-center gap-1 bg-[#10b981]/10 px-2.5 py-1 rounded border border-[#10b981]/30 animate-pulse">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                {saveSuccess}
              </span>
            )}
            {saveError && (
              <span className="text-xs font-bold text-red-400 flex items-center gap-1 bg-red-500/10 px-2.5 py-1 rounded border border-red-500/30">
                <span className="material-symbols-outlined text-sm">error</span>
                {saveError}
              </span>
            )}

            <button
              type="button"
              onClick={handleReset}
              className="px-2.5 sm:px-3 py-1.5 bg-[#1c1b1d] hover:bg-[#27272a] border border-[#2b2a2c] text-[#a1a1aa] hover:text-[#e4e4e7] text-xs font-semibold rounded-md transition-all cursor-pointer"
            >
              Reset Defaults
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 bg-gradient-to-r from-[#facc15] to-[#eab308] hover:brightness-110 text-[#0e0e10] text-xs font-bold rounded-md transition-all cursor-pointer shadow-md disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-sm ${isSaving ? 'animate-spin' : ''}`}>
                {isSaving ? 'sync' : 'save'}
              </span>
              <span>{isSaving ? 'Saving...' : 'Save Configuration'}</span>
            </button>
          </div>
        </header>

        {/* Settings Body */}
        <div className="p-3 sm:p-6 max-w-5xl space-y-4 sm:space-y-6">
          {/* Active Account Live Telemetry Card */}
          {activeAccount && (
            <div className="bg-[#18181b] border border-[#10b981]/30 rounded-xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#10b981]/15 border border-[#10b981]/30 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[#10b981] text-lg">account_balance_wallet</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#e4e4e7]">Active Alpaca Account</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/40">
                      {activeAccount.status}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#a1a1aa] font-mono">
                    ID: {activeAccount.id} ({activeAccount.currency})
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-[#a1a1aa] font-bold">Portfolio Equity</div>
                  <div className="text-sm font-mono font-black text-[#e4e4e7]">
                    ${activeAccount.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-[#a1a1aa] font-bold">Buying Power</div>
                  <div className="text-sm font-mono font-black text-[#10b981]">
                    ${activeAccount.buying_power.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-[#a1a1aa] font-bold">Cash Balance</div>
                  <div className="text-sm font-mono font-black text-[#a1a1aa]">
                    ${activeAccount.cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 1. Alpaca Brokerage Credentials & Live Connection Test */}
          <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-5 shadow-xl">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#2b2a2c]/60">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#facc15] text-lg">vpn_key</span>
                <h3 className="font-bold text-sm text-[#e4e4e7]">Alpaca Brokerage Credentials & Endpoint</h3>
              </div>

              <button
                type="button"
                onClick={testAlpacaConnection}
                disabled={isTesting}
                className="flex items-center gap-1.5 px-3 py-1 bg-[#1c1b1d] hover:bg-[#27272a] border border-[#2b2a2c] hover:border-[#facc15] text-xs font-bold text-[#e4e4e7] rounded-md transition-all cursor-pointer shadow-sm disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-sm text-[#facc15] ${isTesting ? 'animate-spin' : ''}`}>
                  sync
                </span>
                <span>{isTesting ? 'Pinging Alpaca...' : 'Test Connection'}</span>
              </button>
            </div>

            {/* Test Connection Banner */}
            {testResult && (
              <div className={`mb-4 p-3 rounded-lg border text-xs flex items-start gap-2.5 ${
                testResult.success ? 'bg-[#10b981]/10 border-[#10b981]/30 text-[#10b981]' : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}>
                <span className="material-symbols-outlined text-base shrink-0 mt-0.5">
                  {testResult.success ? 'check_circle' : 'error'}
                </span>
                <div className="flex-1">
                  <div className="font-bold">{testResult.success ? 'Connection Verified' : 'Connection Error'}</div>
                  <div className="text-[11px] text-[#e4e4e7] mt-0.5">{testResult.message}</div>
                  {testResult.latency != null && (
                    <div className="text-[10px] text-[#a1a1aa] font-mono mt-1">Roundtrip Latency: {testResult.latency}ms</div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Trading Environment Mode */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider block">
                    Brokerage Environment
                  </label>
                  <span className="text-[9px] text-[#10b981] font-bold uppercase tracking-wider bg-[#10b981]/10 px-1.5 py-0.5 rounded border border-[#10b981]/25 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]"></span>
                    Paper Mode Enforced
                  </span>
                </div>
                <div className="flex bg-[#131315] p-1 rounded-md border border-[#2b2a2c]">
                  <button
                    type="button"
                    onClick={() => setSettings((s) => ({ ...s, environment: 'paper' }))}
                    className="flex-1 py-1.5 text-xs font-bold rounded transition-all bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/40 shadow-sm cursor-default"
                  >
                    Paper Trading (paper-api.alpaca.markets)
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Live Trading is disabled. TradeGuardian operates exclusively in Paper Trading mode to safeguard capital."
                    className="flex-1 py-1.5 text-xs font-bold rounded transition-all cursor-not-allowed opacity-40 bg-[#18181b] text-[#71717a] border border-[#27272a] flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-xs" style={{ fontSize: '13px' }}>lock</span>
                    <span>Live Trading (Unavailable)</span>
                  </button>
                </div>
                <p className="text-[10px] text-[#71717a]">
                  Live account access is permanently restricted to protect capital while autonomous agents run.
                </p>
              </div>

              {/* Data Feed */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider block">
                  Market Data Feed
                </label>
                <div className="relative">
                  <select
                    value={settings.dataFeed}
                    onChange={(e) => setSettings((s) => ({ ...s, dataFeed: e.target.value as any }))}
                    className="w-full bg-[#131315] border border-[#2b2a2c] focus:border-[#facc15] rounded-md px-3 py-2 pr-9 text-xs text-[#e4e4e7] outline-none appearance-none cursor-pointer"
                  >
                    <option value="iex" className="bg-[#18181b] text-[#e4e4e7]">IEX (Free Paper Market Feed)</option>
                    <option value="sip" className="bg-[#18181b] text-[#e4e4e7]">SIP / Consolidated Tape (Direct Brokerage)</option>
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-[#71717a]">
                    expand_more
                  </span>
                </div>
              </div>

              {/* API Key */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider block">
                  Alpaca API Key ID
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={settings.apiKey}
                    onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
                    className="w-full bg-[#131315] border border-[#2b2a2c] focus:border-[#facc15] rounded-md px-3 py-2 text-xs font-mono text-[#e4e4e7] outline-none pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2.5 top-2 text-[#a1a1aa] hover:text-[#e4e4e7]"
                  >
                    <span className="material-symbols-outlined text-sm">
                      {showKey ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>

              {/* API Secret Key */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider block">
                  Alpaca Secret Key
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={settings.apiSecret}
                    onChange={(e) => setSettings((s) => ({ ...s, apiSecret: e.target.value }))}
                    className="w-full bg-[#131315] border border-[#2b2a2c] focus:border-[#facc15] rounded-md px-3 py-2 text-xs font-mono text-[#e4e4e7] outline-none pr-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-2.5 top-2 text-[#a1a1aa] hover:text-[#e4e4e7]"
                  >
                    <span className="material-symbols-outlined text-sm">
                      {showSecret ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Guardian Risk Engine Guardrails */}
          <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-5 shadow-xl">
            <div className="flex items-center gap-2 pb-3 mb-4 border-b border-[#2b2a2c]/60">
              <span className="material-symbols-outlined text-[#10b981] text-lg">shield</span>
              <h3 className="font-bold text-sm text-[#e4e4e7]">Guardian Risk Engine Guardrails</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Max Allocation Per Trade */}
              <div className="space-y-2 bg-[#131315] p-3.5 rounded-lg border border-[#2b2a2c]/60">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#e4e4e7]">Max Portfolio Allocation Per Trade</span>
                  <span className="font-mono font-black text-[#facc15] text-sm bg-[#facc15]/10 px-2 py-0.5 rounded border border-[#facc15]/20">
                    {settings.maxAllocationPerTrade}%
                  </span>
                </div>
                <div className="pt-1 pb-1">
                  <input
                    type="range"
                    min="2"
                    max="30"
                    step="1"
                    value={settings.maxAllocationPerTrade}
                    onChange={(e) => setSettings((s) => ({ ...s, maxAllocationPerTrade: parseInt(e.target.value, 10) }))}
                    className="w-full cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #facc15 0%, #facc15 ${((settings.maxAllocationPerTrade - 2) / (30 - 2)) * 100}%, #27272a ${((settings.maxAllocationPerTrade - 2) / (30 - 2)) * 100}%, #27272a 100%)`,
                    }}
                  />
                  <div className="flex justify-between text-[9px] text-[#71717a] font-mono mt-1">
                    <span>Min: 2%</span>
                    <span>Desk Default: 15%</span>
                    <span>Max: 30%</span>
                  </div>
                </div>
                <p className="text-[10px] text-[#a1a1aa]">Guardian will immediately reject trades exceeding this percentage of account equity.</p>
              </div>

              {/* Max Sector Concentration */}
              <div className="space-y-2 bg-[#131315] p-3.5 rounded-lg border border-[#2b2a2c]/60">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#e4e4e7]">Max Sector / Derivative Concentration</span>
                  <span className="font-mono font-black text-[#38bdf8] text-sm bg-[#38bdf8]/10 px-2 py-0.5 rounded border border-[#38bdf8]/20">
                    {settings.maxSectorConcentration}%
                  </span>
                </div>
                <div className="pt-1 pb-1">
                  <input
                    type="range"
                    min="10"
                    max="50"
                    step="5"
                    value={settings.maxSectorConcentration}
                    onChange={(e) => setSettings((s) => ({ ...s, maxSectorConcentration: parseInt(e.target.value, 10) }))}
                    className="w-full cursor-pointer slider-cyan"
                    style={{
                      background: `linear-gradient(to right, #38bdf8 0%, #38bdf8 ${((settings.maxSectorConcentration - 10) / (50 - 10)) * 100}%, #27272a ${((settings.maxSectorConcentration - 10) / (50 - 10)) * 100}%, #27272a 100%)`,
                    }}
                  />
                  <div className="flex justify-between text-[9px] text-[#71717a] font-mono mt-1">
                    <span>Min: 10%</span>
                    <span>Standard: 25%</span>
                    <span>Max: 50%</span>
                  </div>
                </div>
                <p className="text-[10px] text-[#a1a1aa]">Limits cumulative exposure across correlated underlying assets or single sectors.</p>
              </div>

              {/* Default Take-Profit Target */}
              <div className="space-y-1.5 bg-[#131315] p-3.5 rounded-lg border border-[#2b2a2c]/60">
                <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider block">
                  Default Take-Profit Target (%)
                </label>
                <div className="flex items-center bg-[#0e0e10] border border-[#2b2a2c] focus-within:border-[#10b981] rounded-md px-3 py-1.5 transition-colors">
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="100"
                    value={settings.defaultTakeProfit}
                    onChange={(e) => setSettings((s) => ({ ...s, defaultTakeProfit: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-transparent border-none text-xs font-mono font-bold text-[#10b981] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-xs text-[#10b981] font-bold ml-1">%</span>
                </div>
                <p className="text-[10px] text-[#a1a1aa]">Default profit threshold for auto-calculating limit exit orders.</p>
              </div>

              {/* Default Stop-Loss Guardrail */}
              <div className="space-y-1.5 bg-[#131315] p-3.5 rounded-lg border border-[#2b2a2c]/60">
                <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider block">
                  Default Stop-Loss Guardrail (%)
                </label>
                <div className="flex items-center bg-[#0e0e10] border border-[#2b2a2c] focus-within:border-red-500 rounded-md px-3 py-1.5 transition-colors">
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="50"
                    value={settings.defaultStopLoss}
                    onChange={(e) => setSettings((s) => ({ ...s, defaultStopLoss: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-transparent border-none text-xs font-mono font-bold text-red-400 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-xs text-red-400 font-bold ml-1">%</span>
                </div>
                <p className="text-[10px] text-[#a1a1aa]">Maximum allowable loss before Guardian triggers immediate capital preservation exit.</p>
              </div>
            </div>
          </div>

          {/* 3. Autonomous Execution & Swarm Options */}
          <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-5 shadow-xl">
            <div className="flex items-center gap-2 pb-3 mb-4 border-b border-[#2b2a2c]/60">
              <span className="material-symbols-outlined text-[#a855f7] text-lg">psychology</span>
              <h3 className="font-bold text-sm text-[#e4e4e7]">Autonomous Execution & Swarm Engine</h3>
            </div>

            <div className="space-y-4">
              {/* Auto-execute Exits */}
              <div className="flex items-center justify-between bg-[#131315] p-3.5 rounded-lg border border-[#2b2a2c]/60">
                <div>
                  <div className="text-xs font-bold text-[#e4e4e7]">Autonomous Exit Execution</div>
                  <div className="text-[10px] text-[#a1a1aa]">Automatically submit market exit orders to Alpaca when TP or SL thresholds are breached</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoExecuteExits}
                    onChange={(e) => setSettings((s) => ({ ...s, autoExecuteExits: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#2b2a2c] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#10b981]"></div>
                </label>
              </div>

              {/* Expiration Guard */}
              <div className="flex items-center justify-between bg-[#131315] p-3.5 rounded-lg border border-[#2b2a2c]/60">
                <div>
                  <div className="text-xs font-bold text-[#e4e4e7]">Expiration Guard Threshold (DTE &le; Target)</div>
                  <div className="text-[10px] text-[#a1a1aa]">Trigger mandatory exit review on options contracts within target threshold of expiration</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-[#0e0e10] border border-[#2b2a2c] rounded-md overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSettings((s) => ({ ...s, expirationGuardDte: Math.max(0, (s.expirationGuardDte || 1) - 1) }))}
                      className="px-2.5 py-1 text-xs text-[#a1a1aa] hover:text-[#e4e4e7] hover:bg-[#27272a] transition-colors cursor-pointer select-none font-bold"
                      title="Decrease days"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={settings.expirationGuardDte}
                      onChange={(e) => setSettings((s) => ({ ...s, expirationGuardDte: parseInt(e.target.value, 10) || 0 }))}
                      className="w-8 bg-transparent text-center font-mono font-bold text-xs text-[#facc15] outline-none border-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => setSettings((s) => ({ ...s, expirationGuardDte: Math.min(5, (s.expirationGuardDte || 1) + 1) }))}
                      className="px-2.5 py-1 text-xs text-[#a1a1aa] hover:text-[#e4e4e7] hover:bg-[#27272a] transition-colors cursor-pointer select-none font-bold"
                      title="Increase days"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-[10px] text-[#a1a1aa] font-semibold">Days</span>
                </div>
              </div>

              {/* Polling Frequency */}
              <div className="flex items-center justify-between bg-[#131315] p-3.5 rounded-lg border border-[#2b2a2c]/60">
                <div>
                  <div className="text-xs font-bold text-[#e4e4e7]">Position Monitor Polling Frequency</div>
                  <div className="text-[10px] text-[#a1a1aa]">Rate at which background agents evaluate live quotes and mark-to-market P&L</div>
                </div>
                <div className="relative">
                  <select
                    value={settings.pollingRateMs}
                    onChange={(e) => setSettings((s) => ({ ...s, pollingRateMs: parseInt(e.target.value, 10) }))}
                    className="bg-[#0e0e10] border border-[#2b2a2c] focus:border-[#facc15] rounded-md pl-3 pr-8 py-1.5 text-xs text-[#e4e4e7] outline-none appearance-none cursor-pointer"
                  >
                    <option value={2500} className="bg-[#18181b] text-[#e4e4e7]">2.5s (Ultra-Fast Real-Time)</option>
                    <option value={5000} className="bg-[#18181b] text-[#e4e4e7]">5.0s (Standard Desk)</option>
                    <option value={15000} className="bg-[#18181b] text-[#e4e4e7]">15.0s (Low Bandwidth)</option>
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-[#71717a]">
                    expand_more
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 4. UI & Chart Preferences */}
          <div className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-5 shadow-xl">
            <div className="flex items-center gap-2 pb-3 mb-4 border-b border-[#2b2a2c]/60">
              <span className="material-symbols-outlined text-[#38bdf8] text-lg">palette</span>
              <h3 className="font-bold text-sm text-[#e4e4e7]">UI & Charting Preferences</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider block">
                  Default TradingView Chart Style
                </label>
                <div className="relative">
                  <select
                    value={settings.defaultChartStyle}
                    onChange={(e) => setSettings((s) => ({ ...s, defaultChartStyle: e.target.value as any }))}
                    className="w-full bg-[#131315] border border-[#2b2a2c] focus:border-[#facc15] rounded-md px-3 py-2 pr-8 text-xs text-[#e4e4e7] outline-none appearance-none cursor-pointer"
                  >
                    <option value="8" className="bg-[#18181b] text-[#e4e4e7]">Heikin-Ashi (Continuous Trend Candles)</option>
                    <option value="1" className="bg-[#18181b] text-[#e4e4e7]">Standard Japanese Candlesticks</option>
                    <option value="3" className="bg-[#18181b] text-[#e4e4e7]">Area Chart</option>
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-[#71717a]">
                    expand_more
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between bg-[#131315] p-3 rounded-lg border border-[#2b2a2c]/60">
                <div>
                  <div className="text-xs font-bold text-[#e4e4e7]">Audio Alerts on Order Execution</div>
                  <div className="text-[10px] text-[#a1a1aa]">Play subtle acoustic feedback upon order fills or Guardian risk alerts</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.soundAlerts}
                    onChange={(e) => setSettings((s) => ({ ...s, soundAlerts: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#2b2a2c] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#facc15]"></div>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
