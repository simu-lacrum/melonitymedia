"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Toggle } from "@/components/ui/toggle"

export default function SettingsPage() {
  const [loading, setLoading] = React.useState(false)

  const handleSave = () => {
    setLoading(true)
    setTimeout(() => setLoading(false), 1000)
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
                <Label>CapSolver API Key</Label>
                <Input type="password" placeholder="CAP-..." defaultValue="CAP-XXXX-XXXX-XXXX" />
              </div>
              <div>
                <Label>Proxy Provider API Key</Label>
                <Input type="password" placeholder="Ключ для автопополнения..." />
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
              <Toggle defaultChecked />
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Авто-очистка логов</div>
                <div className="text-body-sm text-text-muted">Удалять логи старше 7 дней</div>
              </div>
              <Toggle defaultChecked />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Двухфакторная аутентификация (2FA)</div>
                <div className="text-body-sm text-text-muted">Использовать приложение-аутентификатор</div>
              </div>
              <Button variant="secondary" size="sm">Включить</Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button variant="primary" size="lg" onClick={handleSave} disabled={loading}>
            {loading ? "Сохранение..." : "Сохранить изменения"}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
