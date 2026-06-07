"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Toggle } from "@/components/ui/toggle"
import { CheckCircle, LogOut, Loader2 } from "lucide-react"
import { api } from "@/lib/api"

const SETTINGS_KEY = "melonity_settings"

interface Settings {
  capsolverKey: string
  proxyProviderKey: string
  strictProxy: boolean
  autoCleanLogs: boolean
}

const DEFAULT_SETTINGS: Settings = {
  capsolverKey: "",
  proxyProviderKey: "",
  strictProxy: true,
  autoCleanLogs: true,
}

export default function SettingsPage() {
  const [settings, setSettings] = React.useState<Settings>(DEFAULT_SETTINGS)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [loggingOut, setLoggingOut] = React.useState(false)

  // Load from localStorage on mount
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (raw) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) })
      }
    } catch {}
  }, [])

  const handleSave = () => {
    setSaving(true)
    setSaved(false)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      setTimeout(() => {
        setSaving(false)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }, 300)
    } catch {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await api.post("/api/auth/logout", {})
    } catch {}
    window.location.href = "/auth/sign-in"
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6 max-w-4xl"
    >
      <div>
        <h1 className="text-display-sm mb-2">Настройки системы</h1>
        <p className="text-body-md text-text-muted">Управление API ключами, капчей и безопасностью</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Интеграции</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="capsolver-key">CapSolver API Key</Label>
                <Input
                  id="capsolver-key"
                  type="password"
                  placeholder="CAP-..."
                  value={settings.capsolverKey}
                  onChange={e => setSettings({ ...settings, capsolverKey: e.target.value })}
                />
                <p className="text-caption text-text-muted mt-1">
                  Используется для автоматического решения капч при загрузке видео
                </p>
              </div>
              <div>
                <Label htmlFor="proxy-key">Proxy Provider API Key</Label>
                <Input
                  id="proxy-key"
                  type="password"
                  placeholder="Ключ для автопополнения..."
                  value={settings.proxyProviderKey}
                  onChange={e => setSettings({ ...settings, proxyProviderKey: e.target.value })}
                />
                <p className="text-caption text-text-muted mt-1">
                  Для автоматического импорта прокси через API провайдера
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Безопасность и Сессии</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Строгий режим прокси</div>
                <div className="text-body-sm text-text-muted">Запретить работу аккаунта при смене подсети прокси</div>
              </div>
              <Toggle
                checked={settings.strictProxy}
                onChange={() => setSettings(s => ({ ...s, strictProxy: !s.strictProxy }))}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Авто-очистка логов</div>
                <div className="text-body-sm text-text-muted">Удалять логи старше 7 дней</div>
              </div>
              <Toggle
                checked={settings.autoCleanLogs}
                onChange={() => setSettings(s => ({ ...s, autoCleanLogs: !s.autoCleanLogs }))}
              />
            </div>

            <div className="border-t border-white/5 pt-4">
              <Button
                variant="ghost"
                className="text-[#F43F5E] hover:text-[#FF1469] hover:bg-[#FF1469]/10"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4 mr-2" />
                )}
                Выйти из аккаунта
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          {saved && (
            <motion.div
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-1 text-[#00d287] text-body-sm"
            >
              <CheckCircle className="w-4 h-4" />
              Сохранено
            </motion.div>
          )}
          <Button variant="primary" size="lg" onClick={handleSave} disabled={saving}>
            {saving ? "Сохранение..." : "Сохранить изменения"}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
