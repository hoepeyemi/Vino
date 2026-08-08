'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { MemoryEvent } from '@/hooks/use-agent-websocket'

// ─── domain layout ────────────────────────────────────────────────────────────

const DOMAINS = ['yield', 'market', 'risk', 'gas', 'user'] as const
type Domain = (typeof DOMAINS)[number]

const DOMAIN_LABELS: Record<Domain, string> = {
  yield: 'YIELD',
  market: 'MARKET',
  risk: 'RISK',
  gas: 'GAS',
  user: 'USER',
}

const DOMAIN_COLORS: Record<Domain, { fill: string; stroke: string; text: string }> = {
  yield:  { fill: '#052e16', stroke: '#10b981', text: '#10b981' },
  market: { fill: '#1e1b4b', stroke: '#8b5cf6', text: '#8b5cf6' },
  risk:   { fill: '#431407', stroke: '#f97316', text: '#f97316' },
  gas:    { fill: '#172554', stroke: '#60a5fa', text: '#60a5fa' },
  user:   { fill: '#1c1917', stroke: '#a8a29e', text: '#a8a29e' },
}

// Normalise tag strings like "yield-strategy" → "yield"
function toDomain(tag?: string): Domain | null {
  if (!tag) return null
  const lower = tag.toLowerCase()
  for (const d of DOMAINS) {
    if (lower.includes(d)) return d
  }
  return null
}

// ─── graph state types ────────────────────────────────────────────────────────

interface L2Node {
  id: string
  domain: Domain | null
  summary: string
  createdAt: number
  active: boolean    // false = pruned (fade out)
  condensedInto?: string // L3 node id
}

interface L3Node {
  id: string
  domain: Domain
  summary: string
  createdAt: number
  sourceCount: number
}

interface GraphState {
  l2: Map<string, L2Node>
  l3: Map<string, L3Node>
  highlighted: Set<string>    // recently recalled / active
}

// ─── layout math ─────────────────────────────────────────────────────────────

const SVG_W = 700
const SVG_H = 340
const PADDING_X = 60
const COL_W = (SVG_W - PADDING_X * 2) / DOMAINS.length
const L3_Y = 64
const L2_START_Y = 148
const L2_ROW_H = 36
const L2_COLS = 2

function l3Cx(domainIdx: number) {
  return PADDING_X + domainIdx * COL_W + COL_W / 2
}

function l2Pos(domainIdx: number, slotIdx: number): { x: number; y: number } {
  const col = slotIdx % L2_COLS
  const row = Math.floor(slotIdx / L2_COLS)
  const colOffset = (col - (L2_COLS - 1) / 2) * 28
  return {
    x: l3Cx(domainIdx) + colOffset,
    y: L2_START_Y + row * L2_ROW_H,
  }
}

// ─── component ────────────────────────────────────────────────────────────────

interface MemoryTopologyGraphProps {
  events: MemoryEvent[]
  className?: string
}

export function MemoryTopologyGraph({ events, className }: MemoryTopologyGraphProps) {
  const [graph, setGraph] = useState<GraphState>({
    l2: new Map(),
    l3: new Map(),
    highlighted: new Set(),
  })
  // Track by the timestamp of the newest processed event rather than array length.
  // events is capped at 100 by the hook, so events.length − processedCount would
  // permanently return 0 once the cap was reached, freezing the graph.
  const lastProcessedTs = useRef(0)
  const highlightTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Process new events incrementally.
  // events is newest-first (prepended in hook), so new items are at the front.
  useEffect(() => {
    const newEvents = events.filter(e => e.timestamp > lastProcessedTs.current)
    if (newEvents.length === 0) return
    // Update the high-water mark before the state update so re-renders don't reprocess
    lastProcessedTs.current = Math.max(...newEvents.map(e => e.timestamp))
    // Reverse so oldest-new is applied first (map mutations are order-sensitive)
    newEvents.reverse()

    setGraph(prev => {
      const l2 = new Map(prev.l2)
      const l3 = new Map(prev.l3)
      const highlighted = new Set(prev.highlighted)

      for (const ev of newEvents) {
        if (ev.type === 'created' && ev.tier === 'L2') {
          const domain = toDomain(ev.domain)
          l2.set(ev.memoryId, {
            id: ev.memoryId,
            domain,
            summary: ev.summary,
            createdAt: ev.timestamp,
            active: true,
          })
          highlighted.add(ev.memoryId)
        }

        if (ev.type === 'condensed' && ev.tier === 'L3') {
          const domain = toDomain(ev.domain) ?? 'yield'
          l3.set(ev.memoryId, {
            id: ev.memoryId,
            domain,
            summary: ev.summary,
            createdAt: ev.timestamp,
            sourceCount: ev.sourceIds?.length ?? 0,
          })
          // Mark source L2 nodes as condensed
          for (const srcId of (ev.sourceIds ?? [])) {
            const node = l2.get(srcId)
            if (node) l2.set(srcId, { ...node, condensedInto: ev.memoryId, active: false })
          }
          highlighted.add(ev.memoryId)
        }

        if (ev.type === 'pruned') {
          if (ev.tier === 'L3') {
            // Individual L3 rule pruned — remove from graph
            l3.delete(ev.memoryId)
          } else if (ev.memoryId === 'batch') {
            // Backend batch-prune: delete all inactive/condensed L2 nodes at once
            for (const [id, n] of Array.from(l2)) {
              if (!n.active) l2.delete(id)
            }
          } else {
            // Individual L2 prune: remove immediately
            l2.delete(ev.memoryId)
          }
        }

        if (ev.type === 'recalled') {
          const ids = ev.memoryId.split(',')
          for (const id of ids) highlighted.add(id.trim())
        }
      }

      return { l2, l3, highlighted }
    })
  }, [events])

  // Clear highlight after 2s.
  // Always reset the timer for any id in the highlighted set so that a memory
  // recalled multiple times within the window gets a fresh 2-second flash each time.
  useEffect(() => {
    for (const id of graph.highlighted) {
      const existing = highlightTimers.current.get(id)
      if (existing !== undefined) clearTimeout(existing)
      const t = setTimeout(() => {
        setGraph(g => {
          const h = new Set(g.highlighted)
          h.delete(id)
          return { ...g, highlighted: h }
        })
        highlightTimers.current.delete(id)
      }, 2000)
      highlightTimers.current.set(id, t)
    }
  }, [graph.highlighted])

  // Cleanup timers on unmount
  useEffect(() => () => {
    for (const t of highlightTimers.current.values()) clearTimeout(t)
  }, [])

  // Slot assignment per domain for L2 nodes
  const l2ByDomain = useMemo(() => {
    const map = new Map<Domain | 'unknown', L2Node[]>()
    for (const node of graph.l2.values()) {
      if (!node.active || node.condensedInto) continue
      const key = node.domain ?? 'unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(node)
    }
    return map
  }, [graph.l2])

  const isEmpty = graph.l2.size === 0 && graph.l3.size === 0

  return (
    <div className={cn('relative', className)}>
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[#444444] pointer-events-none">
          graph populates as the agent accumulates memories
        </div>
      )}

      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-auto"
        style={{ minHeight: 200 }}
      >
        {/* Domain column headers */}
        {DOMAINS.map((domain, di) => {
          const cx = l3Cx(di)
          const col = DOMAIN_COLORS[domain]
          return (
            <text
              key={domain}
              x={cx}
              y={16}
              textAnchor="middle"
              fontSize={9}
              fontFamily="monospace"
              fontWeight="bold"
              fill={col.text}
              opacity={0.6}
            >
              {DOMAIN_LABELS[domain]}
            </text>
          )
        })}

        {/* Tier labels */}
        <text x={8} y={L3_Y + 5} fontSize={8} fontFamily="monospace" fill="#333" textAnchor="start">L3</text>
        <text x={8} y={L2_START_Y + 5} fontSize={8} fontFamily="monospace" fill="#333" textAnchor="start">L2</text>

        {/* Horizontal tier divider */}
        <line x1={22} y1={L3_Y + 28} x2={SVG_W - 8} y2={L3_Y + 28} stroke="#1f1f1f" strokeWidth={1} />

        {/* L3 nodes */}
        {Array.from(graph.l3.values()).map(node => {
          const di = DOMAINS.indexOf(node.domain)
          if (di === -1) return null
          const cx = l3Cx(di)
          const cy = L3_Y
          const col = DOMAIN_COLORS[node.domain]
          const isLit = graph.highlighted.has(node.id)
          return (
            <g key={node.id}>
              <title>{node.summary}</title>
              {isLit && (
                <circle cx={cx} cy={cy} r={22} fill={col.stroke} opacity={0.15}>
                  <animate attributeName="r" values="22;28;22" dur="1s" repeatCount="2" />
                  <animate attributeName="opacity" values="0.15;0.05;0.15" dur="1s" repeatCount="2" />
                </circle>
              )}
              <circle
                cx={cx}
                cy={cy}
                r={18}
                fill={col.fill}
                stroke={col.stroke}
                strokeWidth={isLit ? 2 : 1.5}
              />
              <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={8} fontFamily="monospace" fill={col.text} fontWeight="bold">
                L3
              </text>
              <text x={cx} y={cy + 11} textAnchor="middle" fontSize={7} fontFamily="monospace" fill={col.text} opacity={0.7}>
                {node.sourceCount}ep
              </text>
            </g>
          )
        })}

        {/* L2 nodes + edges to L3 */}
        {DOMAINS.map((domain, di) => {
          const nodesInDomain = l2ByDomain.get(domain) ?? []
          const l3Node = Array.from(graph.l3.values()).find(n => n.domain === domain)
          return nodesInDomain.map((node, si) => {
            const { x, y } = l2Pos(di, si)
            const isLit = graph.highlighted.has(node.id)
            const col = DOMAIN_COLORS[domain]
            return (
              <g key={node.id}>
                <title>{node.summary}</title>
                {/* Edge to L3 if L3 exists */}
                {l3Node && (
                  <line
                    x1={x}
                    y1={y}
                    x2={l3Cx(di)}
                    y2={L3_Y + 18}
                    stroke={col.stroke}
                    strokeWidth={0.5}
                    opacity={0.2}
                    strokeDasharray="3 3"
                  />
                )}
                {isLit && (
                  <circle cx={x} cy={y} r={10} fill={col.stroke} opacity={0.2}>
                    <animate attributeName="r" values="10;14;10" dur="0.8s" repeatCount="2" />
                  </circle>
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={7}
                  fill={isLit ? col.stroke : '#111'}
                  stroke={col.stroke}
                  strokeWidth={isLit ? 1.5 : 1}
                  opacity={isLit ? 1 : 0.75}
                />
              </g>
            )
          })
        })}

        {/* Uncategorised L2 nodes (domain unknown) */}
        {(l2ByDomain.get('unknown') ?? []).map((node, si) => {
          const x = SVG_W - 24
          const y = L2_START_Y + si * 20
          const isLit = graph.highlighted.has(node.id)
          return (
            <g key={node.id}>
              <title>{node.summary}</title>
              <circle
                cx={x}
                cy={y}
                r={5}
                fill={isLit ? '#e5e5e5' : '#111'}
                stroke="#444"
                strokeWidth={1}
                opacity={0.6}
              />
            </g>
          )
        })}

        {/* Condensed L2 → L3 edges (ghost lines from removed L2s) */}
        {Array.from(graph.l2.values())
          .filter(n => n.condensedInto && n.domain)
          .slice(0, 20) // cap to avoid clutter
          .map(node => {
            const l3 = graph.l3.get(node.condensedInto!)
            if (!l3) return null
            const di = DOMAINS.indexOf(l3.domain)
            if (di === -1) return null
            const col = DOMAIN_COLORS[l3.domain]
            return (
              <line
                key={`condensed-${node.id}`}
                x1={l3Cx(di)}
                y1={L3_Y + 18}
                x2={l3Cx(di)}
                y2={L3_Y + 38}
                stroke={col.stroke}
                strokeWidth={0.5}
                opacity={0.08}
              />
            )
          })}

        {/* L1 badge — always shown, fixed bottom-left */}
        <g>
          <rect x={PADDING_X - 20} y={SVG_H - 40} width={64} height={28} rx={4} fill="#111" stroke="#333" strokeWidth={1} />
          <text x={PADDING_X + 12} y={SVG_H - 30} textAnchor="middle" fontSize={7} fontFamily="monospace" fill="#f59e0b" fontWeight="bold">L1 WORKING</text>
          <text x={PADDING_X + 12} y={SVG_H - 20} textAnchor="middle" fontSize={7} fontFamily="monospace" fill="#666">in-process</text>
        </g>

        {/* Legend */}
        <g transform={`translate(${SVG_W - 110}, ${SVG_H - 40})`}>
          <circle cx={6} cy={6} r={6} fill="#052e16" stroke="#10b981" strokeWidth={1} />
          <text x={16} y={10} fontSize={7} fontFamily="monospace" fill="#666">L3 rule (distilled)</text>
          <circle cx={6} cy={22} r={4} fill="#111" stroke="#10b981" strokeWidth={1} />
          <text x={16} y={26} fontSize={7} fontFamily="monospace" fill="#666">L2 episode</text>
        </g>
      </svg>
    </div>
  )
}
