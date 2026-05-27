"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { LiveTerminal } from "@/components/ui/live-terminal"
import { Play, Settings2, Users } from "lucide-react"

export default function WorkspacePage() {
  const [mode, setMode] = React.useState("warming")
  const [loading, setLoading] = React.useState(false)

  const modes = [
    { id: "warming", label: "Прогрев" },
    { id: "commenting", label: "Спам коммент." },
    { id: "follow", label: "Массфолловинг" },
    { id: "upload", label: "Автозалив" },
  ]

  const handleLaunch = () => {
    setLoading(true)
    setTimeout(() => setLoading(false), 2000)
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
                    <div className="font-medium text-white">12 аккаунтов</div>
                    <div className="text-caption text-text-muted">Группа: All TikTok</div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="mb-0">Настройки (JSON)</Label>
                  <Button variant="ghost" size="sm" className="h-8 text-text-muted">
                    <Settings2 className="w-4 h-4 mr-2" />
                    Расширенные
                  </Button>
                </div>
                <div className="bg-[#0A0A0A] border border-white/10 rounded-input p-4 font-mono text-body-sm text-white/80 h-[200px] overflow-auto">
                  {`{
  "mode": "${mode}",
  "concurrency": 5,
  "useRotation": true,
  "headless": true,
  "capsolverEnabled": true,
  "delays": {
    "min": 2000,
    "max": 8000
  }
}`}
                </div>
              </div>

              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={handleLaunch}
                disabled={loading}
              >
                {loading ? (
                  "Подготовка..."
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
