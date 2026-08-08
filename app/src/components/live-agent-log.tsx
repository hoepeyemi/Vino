'use client'

import { useRef } from 'react'
import { cn } from '@/lib/utils'
import type { AgentLogEntry } from '@/hooks/use-agent-websocket'

interface LiveAgentLogProps {
  maxEntries?: number
  className?: string
  compact?: boolean
  liveEntries?: AgentLogEntry[]
  isConnected?: boolean
}

export function LiveAgentLog({
  maxEntries = 6,
  className,
  compact = false,
  liveEntries = [],
  isConnected = false,
}: LiveAgentLogProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const visible = liveEntries.slice(-maxEntries)

  if (!isConnected && visible.length === 0) {
    return (
      <div className={cn('space-y-0', className)}>
        <div className="flex items-center gap-3 py-2 text-[#444444] text-[11px]">
          <span>&gt;</span>
          <span>waiting for agent connection...</span>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn('space-y-0', className)}>
      {visible.map((entry, index) => (
        <div
          key={entry.id}
          className={cn(
            'flex items-start gap-3 py-2 border-b border-[#1f1f1f] last:border-b-0',
            'log-entry-animate',
            index === visible.length - 1 && 'animate-fade-in'
          )}
        >
          <span className="text-[#444444] select-none">&gt;</span>
          <span className={cn(
            'text-[#666666] tabular-nums shrink-0',
            compact ? 'w-16' : 'w-20'
          )}>
            {entry.time}
          </span>
          <span className={cn(
            'flex-1 text-[11px] truncate',
            entry.entryType === 'success' && 'text-[#10b981]',
            entry.entryType === 'warning' && 'text-[#f59e0b]',
            entry.entryType === 'action' && 'text-[#8b5cf6]',
            entry.entryType === 'memory' && 'text-[#60a5fa]',
            entry.entryType === 'info' && 'text-[#e5e5e5]'
          )}
            title={entry.message}
          >
            {entry.message.length > 80 ? entry.message.slice(0, 80) + '…' : entry.message}
          </span>
        </div>
      ))}
    </div>
  )
}
