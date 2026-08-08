"use client"

import { useState, useEffect } from "react"
import { useAccount } from "wagmi"
import { Switch } from "@/components/ui/switch"
import { StatusBar } from "@/components/ui/status-bar"
import { TerminalNav } from "@/components/terminal-nav"
import { LiveAgentLog } from "@/components/live-agent-log"
import { MemoryEventFeed } from "@/components/memory-event-feed"
import { MemoryTopologyGraph } from "@/components/memory-topology-graph"
import { useYieldVault } from "@/hooks/use-yield-vault"
import { useAgentWebSocket } from "@/hooks/use-agent-websocket"
import { formatUnits } from "viem"

export default function AgentPage() {
  const [autoExecute, setAutoExecute] = useState(true)
  const [memoryView, setMemoryView] = useState<'feed' | 'graph'>('graph')
  // totalYieldGenerated on the contract only increments on withdrawal — it reads
  // 0 while yield is actively accruing. Fetch live accruedYield per deposit via
  // the agent API, same approach as the dashboard page.
  const [liveAccruedYield, setLiveAccruedYield] = useState(0)
  const { address, isConnected } = useAccount()
  const { activeDepositsCount } = useYieldVault()
  const { status: wsStatus, memoryEvents, logEntries } = useAgentWebSocket()

  useEffect(() => {
    if (!isConnected) return
    fetch('/api/invoices?active=true', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (!data.success) return
        let total = 0
        for (const inv of data.data.invoices ?? []) {
          if (inv.deposit?.accruedYield) {
            try { total += Number(formatUnits(BigInt(inv.deposit.accruedYield), 18)) } catch {}
          }
        }
        setLiveAccruedYield(total)
      })
      .catch(() => {})
  }, [isConnected])

  const yieldFormatted = liveAccruedYield

  return (
    <div className="min-h-screen bg-[#0a0a0a] bg-grid noise-overlay scan-line pb-8">
      <TerminalNav />

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-[24px] font-bold mb-1">AI AGENT</h1>
            <p className="text-[12px] text-[#666666]">Autonomous yield optimization</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#10b981] status-pulse" />
            <span className="text-[12px] text-[#10b981] font-semibold">ONLINE</span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="stats-grid grid-cols-3 mb-8">
          <div className="stat-cell">
            <div className="stat-label">Monitoring</div>
            <div className="stat-value tabular-nums">{activeDepositsCount}</div>
            <div className="text-[11px] text-[#666666] mt-1">active deposits</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Total Yield Generated</div>
            <div className="stat-value stat-value-green tabular-nums">+${yieldFormatted.toFixed(2)}</div>
            <div className="text-[11px] text-[#666666] mt-1">from vault strategies</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Confidence Threshold</div>
            <div className="stat-value stat-value-amber tabular-nums">70%</div>
            <div className="text-[11px] text-[#666666] mt-1">for auto-execute</div>
          </div>
        </div>

        {/* Agent Controls */}
        <div className="terminal-card p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-[14px] font-semibold mb-1">Agent Controls</h2>
              <p className="text-[11px] text-[#666666]">Configure autonomous decision-making</p>
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 p-4 bg-[#0a0a0a] rounded border border-[#1f1f1f]">
            <div className="flex-1">
              <h3 className="text-[13px] font-semibold mb-1">Auto-Execute Decisions</h3>
              <p className="text-[11px] text-[#666666]">
                Allow the AI agent to automatically implement strategy changes when confidence exceeds 70%.
              </p>
            </div>
            <Switch checked={autoExecute} onCheckedChange={setAutoExecute} />
          </div>

          {autoExecute && (
            <div className="mt-4 p-4 bg-[#10b981]/10 border border-[#10b981]/20 rounded">
              <div className="text-[11px]">
                <span className="text-[#10b981] font-semibold">SAFETY LIMITS ACTIVE</span>
                <ul className="text-[#666666] mt-2 space-y-1">
                  <li>• Max 50% portfolio in aggressive strategies</li>
                  <li>• Min 70% confidence for auto-execution</li>
                  <li>• Manual override always available</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Live Agent Log */}
        <div className="terminal-card mb-6">
          <div className="px-4 py-3 border-b border-[#1f1f1f] bg-[#111111]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Agent Activity</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-[#10b981] status-pulse' : 'bg-[#444444]'}`} />
                <span className={`text-[10px] ${wsStatus === 'connected' ? 'text-[#10b981]' : 'text-[#666666]'}`}>
                  {wsStatus === 'connected' ? 'LIVE' : wsStatus === 'connecting' ? 'CONNECTING' : 'SIMULATED'}
                </span>
              </div>
            </div>
          </div>
          <div className="p-4 text-[12px]">
            <LiveAgentLog
              maxEntries={8}
              liveEntries={logEntries}
              isConnected={wsStatus === 'connected'}
            />
          </div>
        </div>

        {/* Memory System — graph + event feed */}
        <div className="terminal-card mb-8">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[#1f1f1f] bg-[#111111]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold">Memory System</span>
                <span className="text-[10px] text-[#666666]">L1 · L2 · L3</span>
              </div>
              <div className="flex items-center gap-3">
                {/* View toggle */}
                <div className="flex items-center bg-[#0a0a0a] border border-[#1f1f1f] rounded overflow-hidden text-[10px] font-mono">
                  <button
                    onClick={() => setMemoryView('graph')}
                    className={`px-3 py-1 transition-colors ${memoryView === 'graph' ? 'bg-[#8b5cf6] text-white' : 'text-[#666666] hover:text-[#e5e5e5]'}`}
                  >
                    GRAPH
                  </button>
                  <button
                    onClick={() => setMemoryView('feed')}
                    className={`px-3 py-1 transition-colors ${memoryView === 'feed' ? 'bg-[#8b5cf6] text-white' : 'text-[#666666] hover:text-[#e5e5e5]'}`}
                  >
                    FEED
                  </button>
                </div>
                <span className="text-[10px] text-[#666666]">
                  {memoryEvents.length} event{memoryEvents.length !== 1 ? 's' : ''}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] status-pulse" />
                  <span className="text-[10px] text-[#8b5cf6]">MEMORIVAULT</span>
                </div>
              </div>
            </div>
          </div>

          {/* Legend bar — shared between both views */}
          <div className="px-4 py-2 border-b border-[#1f1f1f] flex items-center gap-6 text-[10px] flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-[#10b981] font-mono font-bold">STORE</span>
              <span className="text-[#444444]">new episode</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[#60a5fa] font-mono font-bold">RECALL</span>
              <span className="text-[#444444]">RAG hit</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[#f59e0b] font-mono font-bold">PRUNE</span>
              <span className="text-[#444444]">decayed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[#8b5cf6] font-mono font-bold">DISTILL</span>
              <span className="text-[#444444]">→ L3 rule</span>
            </div>
          </div>

          {/* Body */}
          <div className="p-4">
            {memoryView === 'graph' ? (
              <MemoryTopologyGraph events={memoryEvents} />
            ) : (
              <MemoryEventFeed events={memoryEvents} maxEntries={16} />
            )}
          </div>
        </div>

        {/* Current Tasks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="terminal-card p-6">
            <div className="text-[10px] text-[#666666] uppercase tracking-wider mb-3">Current Tasks</div>
            <div className="space-y-2 text-[12px]">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] status-pulse" />
                <span className="text-[#e5e5e5]">Monitoring Aave V3 supply rates</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] status-pulse" />
                <span className="text-[#e5e5e5]">Checking MON price via Pyth</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] status-pulse" />
                <span className="text-[#e5e5e5]">Analyzing market volatility</span>
              </div>
            </div>
          </div>

          <div className="terminal-card p-6">
            <div className="text-[10px] text-[#666666] uppercase tracking-wider mb-3">Ready to Act</div>
            <p className="text-[12px] text-[#666666] mb-4">
              {activeDepositsCount > 0
                ? `Watching ${activeDepositsCount} active deposits for optimization.`
                : "Deposit an invoice to enable yield optimization."}
            </p>
            <div className="flex items-center gap-6 text-[11px]">
              <div>
                <span className="text-[#666666]">next_check:</span>
                <span className="text-[#10b981] ml-1 tabular-nums">~30s</span>
              </div>
              <div>
                <span className="text-[#666666]">uptime:</span>
                <span className="text-[#10b981] ml-1">24/7</span>
              </div>
            </div>
          </div>
        </div>

        {/* Performance Insights */}
        <div className="stats-grid grid-cols-2">
          <div className="stat-cell">
            <div className="stat-label">Strategy Optimization</div>
            <div className="stat-value stat-value-amber tabular-nums">3.5-7%</div>
            <div className="text-[11px] text-[#666666] mt-1">APY based on strategy</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Risk Management</div>
            <div className="stat-value stat-value-green">24/7</div>
            <div className="text-[11px] text-[#666666] mt-1">Pyth oracle price feeds</div>
          </div>
        </div>
      </main>

      {/* Status Bar */}
      <StatusBar status="online" network="Monad Testnet" />
    </div>
  )
}
