'use client'

import { cn } from '@/lib/utils'
import type { MemoryEvent } from '@/hooks/use-agent-websocket'

interface MemoryEventFeedProps {
  events: MemoryEvent[]
  maxEntries?: number
  className?: string
}

const TYPE_CONFIG = {
  created:   { label: 'STORE',    color: 'text-[#10b981]' },
  recalled:  { label: 'RECALL',   color: 'text-[#60a5fa]' },
  pruned:    { label: 'PRUNE',    color: 'text-[#f59e0b]' },
  condensed: { label: 'DISTILL',  color: 'text-[#8b5cf6]' },
} as const

const TIER_COLOR = {
  L1: 'text-[#e5e5e5]',
  L2: 'text-[#a3a3a3]',
  L3: 'text-[#8b5cf6]',
} as const

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function MemoryEventFeed({ events, maxEntries = 12, className }: MemoryEventFeedProps) {
  const visible = events.slice(0, maxEntries)

  if (visible.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-24 text-[11px] text-[#444444]', className)}>
        waiting for memory events...
      </div>
    )
  }

  return (
    <div className={cn('space-y-0', className)}>
      {visible.map((ev, i) => {
        const cfg = TYPE_CONFIG[ev.type]
        return (
          <div
            key={`${ev.memoryId}-${ev.timestamp}-${i}`}
            className="flex items-start gap-2 py-2 border-b border-[#1f1f1f] last:border-b-0 animate-fade-in"
          >
            <span className="text-[#444444] select-none">&gt;</span>
            <span className="text-[#666666] tabular-nums shrink-0 w-20 text-[11px]">
              {formatTime(ev.timestamp)}
            </span>
            <span className={cn('text-[10px] font-mono font-bold shrink-0 w-14', cfg.color)}>
              {cfg.label}
            </span>
            <span className={cn('text-[10px] font-mono shrink-0 w-6', TIER_COLOR[ev.tier])}>
              {ev.tier}
            </span>
            <span className="flex-1 text-[11px] text-[#e5e5e5] truncate" title={ev.summary}>
              {ev.summary}
            </span>
          </div>
        )
      })}
    </div>
  )
}
