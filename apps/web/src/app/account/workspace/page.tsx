"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { LiveTerminal } from "@/components/ui/live-terminal"
import { Play, Users, Save, Loader2, CheckCircle, AlertCircle } from "lucide-react"
import { api, ApiError } from "@/lib/api"

interface Preset {
  id: string
  name: string
  config: Record<string, unknown>
}

type LaunchStatus = "idle" | "launching" | "success" | "error"

export default function WorkspacePage() {
  const [mode, setMode] = React.useState("WARMUP")
  const [launchStatus, setLaunchStatus] = React.useState<LaunchStatus>("idle")
  const [statusMsg, setStatusMsg] = React.useState("")
  const [presets, setPresets] = React.useState<Preset[]>([])
  const [selectedPresetId, setSelectedPresetId] = React.useState<string>("")
  const [accountCount, setAccountCount] = React.useState(0)
  const [configStr, setConfigStr] = React.useState(`{
  "mode": "WARMUP",
  "concurrency": 5,
  "useRotation": true,
  "headless": true,
  "warmupDays": 10,
  "hashtags": ["dota2", "dota2highlights"]
}`)

  // Load presets + account count on mount
  React.useEffect(() => {
    api.get<{ presets: Preset[] }>("/api/workspace/presets")
      .then((data) => {
        if (data.presets) setPresets(data.presets)
      })
      .catch(console.error)

    api.get<{ accounts: any[] }>("/api/accounts")
      .then((data) => setAccountCount(data.accounts?.length ?? 0))
      .catch(() => {})
  }, [])

  const handleSavePreset = async () => {
    const name = prompt("Введите имя пресета:")
    if (!name) return
    try {
      const config = JSON.parse(configStr)
      const data = await api.post<{ preset: Preset }>("/api/workspace/presets", { name, config })
      setPresets([data.preset, ...presets])
      setSelectedPresetId(data.preset.id)
    } catch {
      alert("Ошибка сохранения: Невалидный JSON")
    }
  }

  const handleLoadPreset = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value
    setSelectedPresetId(id)
    if (!id) return
    const preset = presets.find((p) => p.id === id)
    if (preset) {
      setConfigStr(JSON.stringify(preset.config, null, 2))
    }
  }

  const modes = [
    { id: "WARMUP", label: "Прогрев" },
    { id: "COOKIES", label: "Сбор кук" },
    { id: "EDIT_PROFILE", label: "Ред. профиля" },
    { id: "UPLOAD", label: "Автозалив" },
    { id: "LOGIN", label: "Логин" },
  ]

  const handleLaunch = async () => {
    setLaunchStatus("launching")
    setStatusMsg("")
    try {
      const config = JSON.parse(configStr)
      await api.post("/api/workspace/launch", {
        type: mode,
        accountIds: [],
        applyToAll: true,
        config,
        threads: config.concurrency || 3,
        delayMin: config.delays?.min || 2000,
        delayMax: config.delays?.max || 8000,
      })
      setLaunchStatus("success")
      setStatusMsg("Задача запущена!")
      setTimeout(() => setLaunchStatus("idle"), 3000)
    } catch (err) {
      setLaunchStatus("error")
      if (err instanceof ApiError) {
        setStatusMsg(err.message)
      } else {
        setStatusMsg("Ошибка запуска задачи")
      }
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6 max-w-6xl mx-auto"
    >
      <div>
        <h1 className="text-display-sm mb-2">Воркспейс</h1>
        <p className="text-body-md text-text-muted">Запуск и управление задачами автоматизации</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Конфигурация задачи</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Режим работы</Label>
                <SegmentedControl
                  segments={modes}
                  activeSegment={mode}
                  onChange={setMode}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="mb-0">Аккаунты для работы</Label>
                  <Button variant="ghost" size="sm" className="h-8 text-melon-pink">
                    Выбрать
                  </Button>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-input p-4 flex items-center space-x-3">
                  <Users className="w-5 h-5 text-text-muted" />
                  <div>
                    <div className="font-medium text-white">{accountCount} аккаунтов</div>
                    <div className="text-caption text-text-muted">Все активные (ALIVE)</div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="mb-0">Настройки (JSON)</Label>
                  <div className="flex gap-2">
                    <select 
                      className="bg-white/5 border border-white/10 rounded px-2 text-xs text-white"
                      value={selectedPresetId}
                      onChange={handleLoadPreset}
                    >
                      <option value="">-- Выбрать пресет --</option>
                      {presets.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <Button variant="ghost" size="sm" className="h-8 text-text-muted" onClick={handleSavePreset}>
                      <Save className="w-4 h-4 mr-2" />
                      Сохранить пресет
                    </Button>
                  </div>
                </div>
                <textarea
                  className="w-full bg-[#0A0A0A] border border-white/10 rounded-input p-4 font-mono text-body-sm text-white/80 h-[250px] overflow-auto outline-none resize-none focus:border-melon-pink"
                  value={configStr}
                  onChange={(e) => setConfigStr(e.target.value)}
                />
              </div>

              {/* Status message */}
              {statusMsg && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-body-sm ${
                  launchStatus === "success"
                    ? "bg-[#00d287]/10 text-[#00d287] border border-[#00d287]/20"
                    : "bg-[#F43F5E]/10 text-[#F43F5E] border border-[#F43F5E]/20"
                }`}>
                  {launchStatus === "success" ? (
                    <CheckCircle className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{statusMsg}</span>
                </div>
              )}

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={handleLaunch}
                disabled={launchStatus === "launching"}
              >
                {launchStatus === "launching" ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Подготовка...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 mr-2" />
                    Запустить задачу
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-7">
          <div className="sticky top-24">
            <LiveTerminal />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
