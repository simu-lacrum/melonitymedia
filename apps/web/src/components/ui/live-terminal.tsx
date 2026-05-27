"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { connectSocket, disconnectSocket } from "@/lib/socket"
import { Terminal, Maximize2, Minimize2, X, Play } from "lucide-react"
import { Button } from "@/components/ui/button"

interface LogLine {
  id: string
  timestamp: string
  level: "info" | "error" | "success" | "warning"
  message: string
}

export function LiveTerminal({ taskId }: { taskId?: string }) {
  const [logs, setLogs] = React.useState<LogLine[]>([])
  const [expanded, setExpanded] = React.useState(false)
  const [connected, setConnected] = React.useState(false)
  const bottomRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    // Scroll to bottom when logs change
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  React.useEffect(() => {
    const socket = connectSocket()

    socket.on("connect", () => {
      setConnected(true)
      setLogs((prev) => [
        ...prev,
        { id: Date.now().toString(), timestamp: new Date().toLocaleTimeString(), level: "success", message: "WebSocket Connected: Streaming worker logs..." }
      ])
    })

    socket.on("disconnect", () => {
      setConnected(false)
      setLogs((prev) => [
        ...prev,
        { id: Date.now().toString(), timestamp: new Date().toLocaleTimeString(), level: "error", message: "WebSocket Disconnected." }
      ])
    })

    socket.on("worker:log", (data: LogLine) => {
      if (!taskId || data.message.includes(taskId)) {
        setLogs((prev) => [...prev.slice(-100), data])
      }
    })

    // Simulated logs for UI demonstration
    const interval = setInterval(() => {
      const levels = ["info", "info", "success", "warning"] as const;
      const msgs = [
        "Initializing Patchright browser instance...",
        "Navigating to TikTok login...",
        "Solving capsolver challenge...",
        "Cookie injected successfully.",
        "Detected slow proxy connection, retrying...",
        "Task 'Warming_Up' progressing: 45%",
      ]
      setLogs((prev) => [
        ...prev.slice(-100),
        {
          id: Date.now().toString(),
          timestamp: new Date().toLocaleTimeString(),
          level: levels[Math.floor(Math.random() * levels.length)],
          message: msgs[Math.floor(Math.random() * msgs.length)]
        }
      ])
    }, 3000)

    return () => {
      clearInterval(interval)
      disconnectSocket()
    }
  }, [taskId])

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
      className={`liquid-glass-elevated flex flex-col overflow-hidden transition-all ${
        expanded ? "fixed inset-4 z-50 rounded-2xl" : "h-[400px] rounded-card-base"
      }`}
    >
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-white/5">
        <div className="flex items-center space-x-3">
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
        <div className="flex items-center space-x-2">
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
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-text-muted font-mono text-sm">
            Ожидание логов воркера...
          </div>
        ) : (
          logs.map(renderLog)
        )}
        <div ref={bottomRef} />
      </div>
    </motion.div>
  )
}
