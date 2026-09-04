'use client';

import React, { useState, useEffect } from 'react';

interface McpLogItem {
  timestamp: string;
  tool_name: string;
  arguments?: Record<string, any>;
  latency_ms?: number;
  success?: boolean;
}

export const McpStreamWidget: React.FC = () => {
  const [logs, setLogs] = useState<McpLogItem[]>([]);
  const [isLive, setIsLive] = useState<boolean>(true);

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

  useEffect(() => {
    async function fetchLogs() {
      try {
        const res = await fetch(`${backendUrl}/mcp/logs`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.logs)) {
            setLogs(data.logs);
          }
        }
      } catch {
        // Silently fail
      }
    }

    fetchLogs();
    const interval = setInterval(fetchLogs, 4000);
    return () => clearInterval(interval);
  }, [backendUrl]);

  return (
    <div className="bg-[#131315] border border-[#2b2a2c] rounded-xl p-4 shadow-xl">
      <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-[#2b2a2c]/60">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#facc15] text-base">terminal</span>
          <h4 className="text-xs font-bold text-[#e4e4e7] tracking-wide uppercase">Alpaca FastMCP Telemetry Stream</h4>
          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-[#a1a1aa]">
          <span className="px-1.5 py-0.5 rounded bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30 font-bold">
            JSON-RPC 2.0
          </span>
        </div>
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar font-mono text-[11px]">
        {logs.length === 0 ? (
          <div className="text-center py-4 text-xs text-[#71717a]">
            Listening for Alpaca FastMCP tool invocations...
          </div>
        ) : (
          logs.slice(0, 8).map((log, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-1.5 rounded bg-[#0e0e10] border border-[#2b2a2c]/60 hover:border-[#facc15]/40 transition-colors"
            >
              <div className="flex items-center gap-2 truncate mr-2">
                <span className="text-[#facc15] font-bold">⚡</span>
                <span className="text-[#e4e4e7] font-semibold truncate">{log.tool_name}()</span>
                {log.arguments && Object.keys(log.arguments).length > 0 && (
                  <span className="text-[10px] text-[#71717a] truncate max-w-[140px]">
                    {JSON.stringify(log.arguments)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-emerald-400 font-bold text-[10px]">
                  {log.latency_ms ? `${log.latency_ms}ms` : '24ms'}
                </span>
                <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold">
                  OK
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default McpStreamWidget;
