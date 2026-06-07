"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { CheckCircle, LogOut, Loader2, Key, ShieldCheck } from "lucide-react"
import { api } from "@/lib/api"
import { toast } from "sonner"

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
  const [loggingOut, setLoggingOut] = React.useState(false)

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
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      setTimeout(() => {
        setSaving(false)
        toast.success("Настройки сохранены")
      }, 300)
    } catch {
      setSaving(false)
      toast.error("Ошибка сохранения")
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await api.post("/api/auth/logout", {})
    } catch {}
    toast.success("Вы вышли из системы")
    window.location.href = "/auth/sign-in"
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="flex flex-col gap-6 max-w-4xl"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Настройки системы</h1>
        <p className="text-sm text-muted-foreground mt-1">Управление API ключами, капчей и безопасностью</p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Integrations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="size-4" />
              Интеграции
            </CardTitle>
            <CardDescription>API ключи для внешних сервисов</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="capsolver-key">CapSolver API Key</Label>
              <Input
                id="capsolver-key"
                type="password"
                placeholder="CAP-..."
                value={settings.capsolverKey}
                onChange={e => setSettings({ ...settings, capsolverKey: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Используется для автоматического решения капч при загрузке видео
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="proxy-key">Proxy Provider API Key</Label>
              <Input
                id="proxy-key"
                type="password"
                placeholder="Ключ для автопополнения..."
                value={settings.proxyProviderKey}
                onChange={e => setSettings({ ...settings, proxyProviderKey: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Для автоматического импорта прокси через API провайдера
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="size-4" />
              Безопасность и Сессии
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <div className="text-sm font-medium">Строгий режим прокси</div>
                <div className="text-xs text-muted-foreground mt-0.5">Запретить работу аккаунта при смене подсети прокси</div>
              </div>
              <Switch
                checked={settings.strictProxy}
                onCheckedChange={(v) => setSettings(s => ({ ...s, strictProxy: v }))}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <div className="text-sm font-medium">Авто-очистка логов</div>
                <div className="text-xs text-muted-foreground mt-0.5">Удалять логи старше 7 дней</div>
              </div>
              <Switch
                checked={settings.autoCleanLogs}
                onCheckedChange={(v) => setSettings(s => ({ ...s, autoCleanLogs: v }))}
              />
            </div>

            <Separator />

            <Button
              variant="ghost"
              className="w-fit text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <LogOut className="size-4 mr-2" />
              )}
              Выйти из аккаунта
            </Button>
          </CardContent>
        </Card>

        {/* Save */}
        <div className="flex items-center justify-end">
          <Button size="lg" onClick={handleSave} disabled={saving}>
            {saving ? "Сохранение..." : "Сохранить изменения"}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
