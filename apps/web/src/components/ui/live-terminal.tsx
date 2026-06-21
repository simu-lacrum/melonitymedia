"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { ensureConnected, getSnapshot, subscribe, clearLogs, type LogLine } from "@/lib/log-store"
import { Terminal, Maximize2, Minimize2, X, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export function LiveTerminal({ taskId }: { taskId?: string }) {
  // Subscribe to global log store (survives navigation)
  const [state, setState] = React.useState(getSnapshot)
  const [expanded, setExpanded] = React.useState(false)
  const bottomRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    // Ensure socket is connected on mount (idempotent)
    ensureConnected()

    // Subscribe to store updates
    const unsub = subscribe(() => {
      setState(getSnapshot())
    })

    return unsub
    // NOTE: we do NOT disconnect on unmount — socket stays alive globally
  }, [])

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [state.logs])

  const { logs, connected } = state

  // Filter logs by taskId if provided
  const filteredLogs = taskId
    ? logs.filter((log) => log.message.includes(taskId) || log.level === "success" || log.level === "error")
    : logs

  const renderLog = (log: LogLine) => {
    let color = "text-text-muted"
    if (log.level === "error") color = "text-[#F43F5E]"
    if (log.level === "success") color = "text-[#00D287]"
    if (log.level === "warning") color = "text-[#F59E0B]"

    return (
      <div key={log.id} className="font-mono text-[13px] leading-relaxed break-all">
        <span className="text-white/40 mr-3">[{log.timestamp}]</span>
        <span className={color}>{log.message}</span>
      </div>
    )
  }

  return (
    <motion.div
      layout
      className={`liquid-glass flex flex-col overflow-hidden transition-[height,border-radius] duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
        expanded ? "fixed inset-4 z-[100] h-[calc(100dvh-2rem)] rounded-2xl" : "h-[400px] rounded-card-base"
      }`}
    >
      <div className="flex items-center justify-between gap-3 p-4 border-b border-white/10 bg-white/5">
        <div className="flex min-w-0 items-center space-x-3">
          <Terminal className="w-5 h-5 text-white/70" />
          <h3 className="font-medium">Live Terminal</h3>
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2.5 w-2.5">
              {connected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00D287] opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? "bg-[#00D287]" : "bg-white/20"}`}></span>
            </span>
            <span className="text-caption text-text-muted">{connected ? "Connected" : "Offline"}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center space-x-2">
          <Button variant="ghost" size="icon" onClick={() => clearLogs()} className="w-8 h-8 hover:bg-white/10" title="Очистить логи">
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setExpanded(!expanded)} className="w-8 h-8 hover:bg-white/10">
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
          {expanded && (
            <Button variant="ghost" size="icon" onClick={() => setExpanded(false)} className="w-8 h-8 hover:bg-[#F43F5E]/10 hover:text-[#F43F5E]">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-auto p-4 space-y-1 bg-[#0A0A0A]/50">
        {filteredLogs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-muted font-mono text-sm">
            Ожидание логов воркера...
          </div>
        ) : (
          filteredLogs.map(renderLog)
        )}
        <div ref={bottomRef} />
      </div>
    </motion.div>
  )
}
