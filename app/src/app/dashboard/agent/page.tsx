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

// ─── Cleanverse Integration Health Panel ─────────────────────────────────────

interface HealthEndpoint {
  id: string
  method: string
  name: string
  category: 'CVI' | 'CVA' | 'compliance'
  encryption: string
  route: string
  status: 'live' | 'fallback' | 'unconfigured'
  fallback: string
  contract?: string
}

interface HealthData {
  configured: boolean
  relayConfigured: boolean
  mockCviAddress: string
  apiBase: string | null
  chain: string
  endpoints: HealthEndpoint[]
  summary: { total: number; live: number; fallback: number; unconfigured: number }
  checkedAt: string
}

const CATEGORY_COLOR: Record<string, string> = {
  CVI: '#10b981',
  CVA: '#10b981',
  compliance: '#f59e0b',
}

const STATUS_COLOR: Record<string, string> = {
  live:         '#10b981',
  fallback:     '#f59e0b',
  unconfigured: '#555555',
}

function CleanverseHealthPanel() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetch('/api/cleanverse/health')
      .then(r => r.json())
      .then((d: HealthData) => setHealth(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="terminal-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] status-pulse" />
          <span className="text-[10px] uppercase tracking-[0.2em] text-[#10b981] font-semibold">
            Cleanverse Integration
          </span>
          <span className="text-[10px] text-[#444444]">· 7 API endpoints</span>
        </div>
        {health && (
          <div className="flex items-center gap-3 text-[9px] font-mono">
            <span style={{ color: STATUS_COLOR.live }}>
              {health.summary.live} live
            </span>
            {health.summary.fallback > 0 && (
              <span style={{ color: STATUS_COLOR.fallback }}>
                {health.summary.fallback} fallback
              </span>
            )}
            {health.summary.unconfigured > 0 && (
              <span style={{ color: STATUS_COLOR.unconfigured }}>
                {health.summary.unconfigured} unconfigured
              </span>
            )}
          </div>
        )}
      </div>

      {loading && (
        <div className="text-[10px] text-[#444444] font-mono">checking endpoints…</div>
      )}

      {health && (
        <>
          {/* Config badges */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
              health.configured
                ? 'border-[#10b981]/30 bg-[#10b981]/10 text-[#10b981]'
                : 'border-[#333333] text-[#555555]'
            }`}>
              {health.configured ? '✓ API credentials' : '✗ API credentials missing'}
            </span>
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
              health.relayConfigured
                ? 'border-[#10b981]/30 bg-[#10b981]/10 text-[#10b981]'
                : 'border-[#333333] text-[#555555]'
            }`}>
              {health.relayConfigured ? '✓ relay key (MockCVI)' : '✗ relay key missing'}
            </span>
            <span className="text-[9px] font-mono text-[#444444]">
              {health.chain}
            </span>
            {health.apiBase && (
              <span className="text-[9px] font-mono text-[#333333] hidden sm:block truncate">
                {health.apiBase}
              </span>
            )}
          </div>

          {/* Endpoint table */}
          <div className="space-y-1">
            {(['CVI', 'CVA', 'compliance'] as const).map(cat => (
              <div key={cat}>
                <div className="text-[8px] uppercase tracking-[0.2em] mb-1 mt-2"
                  style={{ color: CATEGORY_COLOR[cat] + '80' }}>
                  {cat}
                </div>
                {health.endpoints.filter(e => e.category === cat).map(ep => (
                  <div key={ep.id}
                    className="flex items-start gap-2 py-1 border-b border-[#111111] last:border-0">
                    {/* status dot */}
                    <span className="shrink-0 mt-[3px] w-1.5 h-1.5 rounded-full"
                      style={{ background: STATUS_COLOR[ep.status] }} />
                    {/* method badge */}
                    <span className="shrink-0 text-[8px] font-mono w-8"
                      style={{ color: CATEGORY_COLOR[cat] + 'aa' }}>
                      {ep.method}
                    </span>
                    {/* name */}
                    <span className="text-[10px] font-mono text-[#d6d6d6] w-44 shrink-0 truncate">
                      {ep.name}
                    </span>
                    {/* encryption */}
                    <span className="text-[8px] font-mono text-[#333333] w-20 shrink-0">
                      {ep.encryption}
                    </span>
                    {/* status */}
                    <span className="text-[9px] font-mono shrink-0"
                      style={{ color: STATUS_COLOR[ep.status] }}>
                      {ep.status}
                    </span>
                    {/* fallback note */}
                    {ep.status !== 'live' && (
                      <span className="text-[8px] text-[#444444] truncate hidden sm:block">
                        → {ep.fallback}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* MockCVI contract */}
          <div className="mt-3 pt-2.5 border-t border-[#1a1a1a] flex items-center gap-2 text-[9px] font-mono">
            <span className="text-[#444444]">MockCVI:</span>
            <a
              href={`https://testnet.monadexplorer.com/address/${health.mockCviAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#10b981] hover:underline truncate"
            >
              {health.mockCviAddress.slice(0, 12)}…{health.mockCviAddress.slice(-6)} ↗
            </a>
            <span className="text-[#333333]">Monad Testnet</span>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AgentPage() {
  const [autoExecute, setAutoExecute] = useState(true)
  const [memoryView, setMemoryView] = useState<'feed' | 'graph'>('graph')
  // totalYieldGenerated on the contract only increments on withdrawal — it reads
  // 0 while yield is actively accruing. Fetch live accruedYield per deposit via
  // the agent API, same approach as the dashboard page.
  const [liveAccruedYield, setLiveAccruedYield] = useState(0)
  const { isConnected } = useAccount()
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

        {/* Monad Scalability — shows judges the throughput the agent operates on */}
        <div className="border border-[#1f1f1f] rounded p-3 mb-6 bg-[#0d0d0d]">
          <div className="flex items-center justify-between flex-wrap gap-3 text-[10px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#836EF9] status-pulse" />
              <span className="text-[#836EF9] font-semibold uppercase tracking-wider">Monad Testnet</span>
              <span className="text-[#333333]">· Chain 10143</span>
            </div>
            <div className="flex items-center gap-6">
              <div>
                <span className="text-[#444444]">tps: </span>
                <span className="text-[#e5e5e5] font-semibold">10,000</span>
              </div>
              <div>
                <span className="text-[#444444]">finality: </span>
                <span className="text-[#e5e5e5] font-semibold">~0.5s</span>
              </div>
              <div>
                <span className="text-[#444444]">base_fee: </span>
                <span className="text-[#e5e5e5] font-semibold">~100 Gwei</span>
              </div>
              <div>
                <span className="text-[#444444]">agent_cycle: </span>
                <span className="text-[#10b981] font-semibold">5 min</span>
              </div>
            </div>
          </div>
        </div>

        {/* Compliance Context — CVI/CVA rails the agent operates within */}
        <div className="terminal-card p-4 mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] status-pulse" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-[#10b981] font-semibold">Compliance Context</span>
            <span className="text-[10px] text-[#444444]">· agent operates within Cleanverse rails</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-2 rounded border border-[#1f1f1f] bg-[#0a0a0a]">
              <div className="text-[10px] text-[#10b981] font-semibold mb-0.5">CVI Gate</div>
              <div className="text-[10px] text-[#555555]">Only A-Pass verified wallets can deposit to vault</div>
            </div>
            <div className="p-2 rounded border border-[#1f1f1f] bg-[#0a0a0a]">
              <div className="text-[10px] text-[#10b981] font-semibold mb-0.5">CVA Settlement</div>
              <div className="text-[10px] text-[#555555]">Yield paid in USDC · USDT · EURC A-Tokens</div>
            </div>
            <div className="p-2 rounded border border-[#1f1f1f] bg-[#0a0a0a]">
              <div className="text-[10px] text-[#10b981] font-semibold mb-0.5">Travel Rule</div>
              <div className="text-[10px] text-[#555555]">FATF Rec-16 · auto-fill on all invoice transactions</div>
            </div>
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
            <div className="space-y-2 text-[11px]">
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] status-pulse mt-1 shrink-0" />
                <span className="text-[#e5e5e5]">Monitoring Aave V3 supply rates <span className="text-[#444444]">· USDC · USDT</span></span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] status-pulse mt-1 shrink-0" />
                <span className="text-[#e5e5e5]">Fetching MON/USD via Pyth oracle <span className="text-[#444444]">· risk score update</span></span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6] status-pulse mt-1 shrink-0" />
                <span className="text-[#e5e5e5]">
                  Calling <span className="font-mono text-[#8b5cf6]">MockCVI.isVerified()</span> before each settlement
                  <span className="ml-1.5 text-[9px] text-[#444444]">on-chain gate</span>
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] status-pulse mt-1 shrink-0" />
                <span className="text-[#e5e5e5]">
                  Checking CVA A-Token eligibility <span className="font-mono text-[10px] text-[#444444]">verify_apass</span>
                  <span className="ml-1.5 text-[9px] text-[#444444]">per deposit cycle</span>
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] status-pulse mt-1 shrink-0" />
                <span className="text-[#e5e5e5]">Cooldown check on <span className="font-mono text-[10px] text-[#f59e0b]">AgentRouter.lastAnalysis</span> <span className="text-[#444444]">· avoids gas waste</span></span>
              </div>
            </div>
          </div>

          <div className="terminal-card p-6">
            <div className="text-[10px] text-[#666666] uppercase tracking-wider mb-3">Decision Cycle</div>
            <div className="space-y-2 text-[10px] font-mono mb-4">
              {([
                { tag: 'CVI',  color: '#10b981', desc: 'MockCVI.isVerified() gate before each tx' },
                { tag: 'CVA',  color: '#10b981', desc: 'verify_apass eligibility per deposit cycle' },
                { tag: 'MEM',  color: '#8b5cf6', desc: 'MemoriVault RAG recall · L1→L2→L3' },
                { tag: 'LLM',  color: '#8b5cf6', desc: 'Qwen 70B risk analysis · confidence ≥ 0.70' },
                { tag: 'GAS',  color: '#f59e0b', desc: 'nonce mutex · baseFee×1.2 · 500 Gwei cap' },
              ] as const).map(({ tag, color, desc }) => (
                <div key={tag} className="flex items-start gap-2">
                  <span className="shrink-0 w-7 font-semibold" style={{ color }}>{tag}</span>
                  <span className="text-[#333333]">→</span>
                  <span className="text-[#555555]">{desc}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 text-[10px] pt-3 border-t border-[#1a1a1a]">
              <div><span className="text-[#444444]">cycle:</span><span className="text-[#10b981] ml-1">5 min</span></div>
              <div><span className="text-[#444444]">deposits:</span><span className="text-[#10b981] ml-1">{activeDepositsCount} active</span></div>
              <div><span className="text-[#444444]">uptime:</span><span className="text-[#10b981] ml-1">24/7</span></div>
            </div>
          </div>
        </div>

        {/* Performance Insights */}
        <div className="stats-grid grid-cols-2 md:grid-cols-4 mb-8">
          <div className="stat-cell">
            <div className="stat-label">Strategy APY Range</div>
            <div className="stat-value stat-value-amber tabular-nums">3.5–7%</div>
            <div className="text-[11px] text-[#666666] mt-1">Aave V3 Hold→Aggressive</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Risk Feeds</div>
            <div className="stat-value stat-value-green">24/7</div>
            <div className="text-[11px] text-[#666666] mt-1">Pyth oracle · MON/USD</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">Memory Depth</div>
            <div className="stat-value tabular-nums text-[#8b5cf6]">L1·L2·L3</div>
            <div className="text-[11px] text-[#666666] mt-1">Qwen embed 1024-dim RAG</div>
          </div>
          <div className="stat-cell">
            <div className="stat-label">CVI Gate</div>
            <div className="stat-value stat-value-green">ON-CHAIN</div>
            <div className="text-[11px] text-[#666666] mt-1">MockCVI.isVerified()</div>
          </div>
        </div>

        {/* Cleanverse Integration Status — all 7 endpoints */}
        <CleanverseHealthPanel />
      </main>

      {/* Status Bar */}
      <StatusBar status="online" network="Monad Testnet" />
    </div>
  )
}
