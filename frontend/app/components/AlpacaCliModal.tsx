'use client';

import React, { useState } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const AlpacaCliModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [commandInput, setCommandInput] = useState<string>('account');
  const [output, setOutput] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [exitCode, setExitCode] = useState<number | null>(null);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  if (!isOpen) return null;

  const executeCliCommand = async (cmdString?: string) => {
    const raw = (cmdString ?? commandInput).trim();
    if (!raw) return;

    // Strip leading "alpaca" if user included it
    const args = raw.startsWith('alpaca ') ? raw.slice(7).trim().split(/\s+/) : raw.split(/\s+/);

    setIsRunning(true);
    setOutput(null);

    try {
      const res = await fetch(`${backendUrl}/mcp/cli`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args }),
      });

      if (res.ok) {
        const data = await res.json();
        setExitCode(data.exit_code ?? 0);
        if (data.data) {
          setOutput(typeof data.data === 'object' ? JSON.stringify(data.data, null, 2) : String(data.data));
        } else if (data.error) {
          setOutput(`[CLI Error]:\n${data.error}\n\n${data.installation || ''}`);
        } else {
          setOutput(JSON.stringify(data, null, 2));
        }
      } else {
        setOutput(`HTTP Error ${res.status}: Unable to execute Alpaca CLI`);
      }
    } catch (err: any) {
      setOutput(`Error connecting to CLI runner: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl bg-[#131315] border border-[#2b2a2c] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Terminal Header */}
        <div className="px-5 py-3.5 border-b border-[#2b2a2c] bg-[#18181b] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/80 inline-block" />
              <span className="w-3 h-3 rounded-full bg-green-500/80 inline-block" />
            </div>
            <span className="text-xs font-bold text-[#e4e4e7] font-mono ml-2">Alpaca Official Go CLI Terminal</span>
            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#facc15]/15 text-[#facc15] border border-[#facc15]/30">
              v2.3.1
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-[#a1a1aa] hover:text-[#e4e4e7] text-sm font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Quick presets */}
        <div className="px-5 py-2.5 bg-[#0e0e10] border-b border-[#2b2a2c]/60 flex items-center gap-2 overflow-x-auto text-xs font-mono">
          <span className="text-[10px] text-[#71717a] uppercase font-bold shrink-0">Presets:</span>
          {[
            { label: 'alpaca account', cmd: 'account' },
            { label: 'alpaca positions', cmd: 'positions' },
            { label: 'alpaca orders list', cmd: 'orders list' },
            { label: 'alpaca clock', cmd: 'clock' },
          ].map((preset) => (
            <button
              key={preset.cmd}
              type="button"
              onClick={() => {
                setCommandInput(preset.cmd);
                executeCliCommand(preset.cmd);
              }}
              className="px-2 py-1 rounded bg-[#1c1b1d] hover:bg-[#facc15] text-[#a1a1aa] hover:text-[#0e0e10] border border-[#2b2a2c] hover:border-[#facc15] font-semibold transition-all cursor-pointer shrink-0 text-[11px]"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Command Input Bar */}
        <div className="p-4 bg-[#141416] border-b border-[#2b2a2c]/60 flex items-center gap-2 font-mono text-xs">
          <span className="text-[#10b981] font-bold">alpaca</span>
          <span className="text-[#facc15] font-bold">&gt;</span>
          <input
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') executeCliCommand();
            }}
            placeholder="e.g. account, positions, clock..."
            className="flex-1 bg-transparent border-0 outline-none text-[#e4e4e7] placeholder-[#71717a]"
          />
          <button
            type="button"
            onClick={() => executeCliCommand()}
            disabled={isRunning}
            className="px-3 py-1 rounded bg-[#facc15] hover:brightness-110 text-[#0e0e10] font-bold text-xs transition-all cursor-pointer disabled:opacity-50"
          >
            {isRunning ? 'Running...' : 'Execute'}
          </button>
        </div>

        {/* Output Window */}
        <div className="p-5 flex-1 overflow-y-auto custom-scrollbar font-mono text-xs bg-[#0b0b0d] text-[#e4e4e7]">
          {output ? (
            <pre className="whitespace-pre-wrap leading-relaxed text-[#10b981]">
              {output}
            </pre>
          ) : (
            <div className="text-[#71717a] py-8 text-center text-xs">
              Select a preset command above or type an argument and press <span className="text-[#facc15]">Execute</span> to inspect real-time Alpaca CLI output.
            </div>
          )}
        </div>

        {/* Terminal Footer */}
        <div className="px-5 py-2.5 bg-[#18181b] border-t border-[#2b2a2c] flex items-center justify-between text-[10px] text-[#a1a1aa] font-mono">
          <span>Environment: APCA_API_BASE_URL=https://paper-api.alpaca.markets</span>
          {exitCode !== null && (
            <span className={exitCode === 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
              Exit Code: {exitCode}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default AlpacaCliModal;
