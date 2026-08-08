'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

export interface MemoryEvent {
  type: 'created' | 'recalled' | 'pruned' | 'condensed'
  tier: 'L1' | 'L2' | 'L3'
  memoryId: string
  summary: string
  timestamp: number
  reason?: string
  domain?: string
  sourceIds?: string[]
}

export interface AgentLogEntry {
  id: number
  time: string
  message: string
  entryType: 'info' | 'success' | 'warning' | 'action' | 'memory'
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export function useAgentWebSocket() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [memoryEvents, setMemoryEvents] = useState<MemoryEvent[]>([])
  const [logEntries, setLogEntries] = useState<AgentLogEntry[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idCounter = useRef(0)

  const pushLog = useCallback((message: string, entryType: AgentLogEntry['entryType'] = 'info') => {
    const entry: AgentLogEntry = {
      id: ++idCounter.current,
      time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      message,
      entryType,
    }
    setLogEntries(prev => [...prev, entry].slice(-50))
  }, [])

  const connect = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_AGENT_WS_URL
    if (!wsUrl) return

    const token = process.env.NEXT_PUBLIC_WS_AUTH_TOKEN
    const url = token ? `${wsUrl}?token=${token}` : wsUrl

    setStatus('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      pushLog('agent connection established', 'success')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)

        if (msg.type === 'memory') {
          const ev = msg.payload as MemoryEvent
          setMemoryEvents(prev => [ev, ...prev].slice(0, 100))

          const tierLabel = ev.tier
          const label =
            ev.type === 'created' ? `[MEM] stored ${tierLabel}: ${ev.summary}` :
            ev.type === 'recalled' ? `[MEM] recalled ${tierLabel}: ${ev.summary}` :
            ev.type === 'pruned' ? `[MEM] pruned ${tierLabel}: ${ev.reason ?? ev.summary}` :
            `[MEM] condensed → ${tierLabel}: ${ev.summary}`
          const entryType: AgentLogEntry['entryType'] =
            ev.type === 'pruned' ? 'warning' :
            ev.type === 'condensed' ? 'action' :
            'memory'
          pushLog(label, entryType)

        } else if (msg.type === 'thought') {
          const t = msg.payload as { message: string; type: string }
          const entryType: AgentLogEntry['entryType'] =
            t.type === 'error' ? 'warning' :
            t.type === 'decision' ? 'action' :
            t.type === 'execution' ? 'success' : 'info'
          pushLog(t.message, entryType)

        } else if (msg.type === 'decision') {
          const d = msg.payload as { tokenId: string; confidence: number; recommendedStrategy: number }
          pushLog(`decision: token #${d.tokenId} → strategy ${d.recommendedStrategy} (${Math.round(d.confidence)}% conf)`, 'action')

        } else if (msg.type === 'execution') {
          const e = msg.payload as { tokenId?: string }
          pushLog(`executed: token #${e.tokenId ?? '?'}`, 'success')

        } else if (msg.type === 'status') {
          const s = msg.payload as { status: string }
          pushLog(`status: ${s.status}`, 'info')

        } else if (msg.type === 'error') {
          const e = msg.payload as { message?: string }
          pushLog(`error: ${e.message ?? 'unknown'}`, 'warning')
        }
      } catch {
        // ignore malformed frames
      }
    }

    ws.onclose = () => {
      // Preserve 'error' status if onclose was triggered by onerror — React
      // batches setState calls so the last write wins; using a flag ensures the
      // error state is visible to the UI rather than being overwritten here.
      setStatus(s => s === 'error' ? 'error' : 'disconnected')
      wsRef.current = null
      reconnectTimer.current = setTimeout(connect, 5000)
    }

    ws.onerror = () => {
      setStatus('error')
      ws.close()
    }
  }, [pushLog])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      const ws = wsRef.current
      if (ws) {
        // Null handlers before closing so the async onclose doesn't fire
        // setState or schedule a reconnect after this component unmounts.
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
        ws.close()
        wsRef.current = null
      }
    }
  }, [connect])

  return { status, memoryEvents, logEntries }
}
