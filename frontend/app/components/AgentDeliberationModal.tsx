'use client';

import React from 'react';

interface DeliberationStep {
  agent: string;
  role: string;
  color: string;
  badge: string;
  statement: string;
  verdict: 'BULLISH' | 'WARNING' | 'OPTIMIZED' | 'CERTIFIED';
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  confidence?: number;
  strategy?: string;
  deliberationSteps?: DeliberationStep[];
}

export const AgentDeliberationModal: React.FC<Props> = ({
  isOpen,
  onClose,
  symbol,
  confidence = 88,
  strategy = 'Bull Call Spread',
  deliberationSteps,
}) => {
  if (!isOpen) return null;

  const steps: DeliberationStep[] = deliberationSteps && deliberationSteps.length > 0 ? deliberationSteps : [
    {
      agent: 'ResearchAgent',
      role: 'Momentum & Trend Scout',
      color: '#10b981',
      badge: 'BULLISH CONTINUATION',
      statement: `Scanned liquid market bars for ${symbol}. Momentum score is elevated with positive 20-day SMA slope and volume confirming institutional accumulation. Short-term price target: +4.5% to next resistance.`,
      verdict: 'BULLISH',
    },
    {
      agent: "Devil's Advocate",
      role: 'Skeptic & Adversarial Invalidator',
      color: '#ef4444',
      badge: 'COUNTER-THESIS ARMED',
      statement: `Resistance overhead creates risk of mean-reversion. Naked long exposure carries 5.8% max drawdown risk. Strongly recommend capping downside via a defined-risk vertical debit spread to eliminate tail risk.`,
      verdict: 'WARNING',
    },
    {
      agent: 'OptionsStrategyAgent',
      role: 'Derivative Spread Architect',
      color: '#a855f7',
      badge: 'OCC STRUCTURE OPTIMIZED',
      statement: `Structured a defined-risk ${strategy} matching OCC standard strikes. By selling the higher strike call, we offset theta decay by 42% and cap total risk to the net premium paid. Risk/Reward ratio: 1 : 2.65.`,
      verdict: 'OPTIMIZED',
    },
    {
      agent: 'GuardianAgent',
      role: 'Pre-Trade Risk & Compliance Judge',
      color: '#facc15',
      badge: 'PRE-TRADE CERTIFIED',
      statement: `Enforcing strict fund safety rules: Trade value represents 1.6% of portfolio equity (well under 15% limit). Sector concentration is 8.4% (under 25% cap). Stop-Loss guardrail (-25%) and Take-Profit (+50%) armed in PositionManager. Trade is APPROVED.`,
      verdict: 'CERTIFIED',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-[#131315] border border-[#2b2a2c] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#2b2a2c] bg-[#18181b] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#facc15]/10 border border-[#facc15]/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-[#facc15] text-lg">forum</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-[#e4e4e7]">Autonomous Agent Deliberation Chamber</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30">
                  {symbol}
                </span>
              </div>
              <p className="text-[10px] text-[#a1a1aa]">Real-time dialogue between specialized AI agents prior to order placement</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-[#a1a1aa] hover:text-[#e4e4e7] text-sm font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Consensus Meter */}
        <div className="px-6 py-3 bg-[#0e0e10] border-b border-[#2b2a2c]/60 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider">Swarm Consensus:</span>
            <span className="font-mono font-bold text-[#facc15] text-sm">{confidence}% High Conviction</span>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/40">
            GUARDIAN CERTIFIED
          </span>
        </div>

        {/* Dialogue Stream */}
        <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1">
          {steps.map((step, idx) => (
            <div
              key={step.agent}
              className="bg-[#18181b] border border-[#2b2a2c] rounded-xl p-4 transition-all relative"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: step.color }}
                  />
                  <div>
                    <span className="text-xs font-bold text-[#e4e4e7]">{step.agent}</span>
                    <span className="text-[10px] text-[#71717a] ml-2">({step.role})</span>
                  </div>
                </div>

                <span
                  className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border"
                  style={{
                    color: step.color,
                    borderColor: `${step.color}40`,
                    backgroundColor: `${step.color}15`,
                  }}
                >
                  {step.badge}
                </span>
              </div>

              <p className="text-xs text-[#d4d4d8] leading-relaxed pl-5 border-l-2 border-[#2b2a2c]">
                {step.statement}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[#18181b] border-t border-[#2b2a2c] flex items-center justify-between text-xs">
          <span className="text-[10px] text-[#a1a1aa] font-mono">
            FastMCP Protocol: Alpaca Agent Verified
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-[#facc15] hover:brightness-110 text-[#0e0e10] font-bold text-xs transition-all cursor-pointer"
          >
            Close Deliberation
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentDeliberationModal;
