"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Server, Database, HardDrive, Cpu, Shield, Users, Ban,
  Loader2, RefreshCw, Plus, Trash2, AlertCircle
} from "lucide-react"
import { api, ApiError } from "@/lib/api"

interface RuntimeData {
  db: string
  redis: string
  activeTasks: number
  system: {
    cpuLoad: number[]
    memoryUsed: number
    memoryTotal: number
    memoryPercent: number
    uptime: number
  }
}

interface AdminUser {
  id: string
  email: string
  name?: string
  role: string
  maxThreads: number
  isBanned: boolean
  bannedAt?: string
  createdAt: string
  _count: { accounts: number; tasks: number }
}

export default function AdminPage() {
  const [runtime, setRuntime] = React.useState<RuntimeData | null>(null)
  const [users, setUsers] = React.useState<AdminUser[]>([])
  const [blockedIps, setBlockedIps] = React.useState<string[]>([])
  const [newIp, setNewIp] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const loadAll = React.useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [rt, u, fw] = await Promise.all([
        api.get<RuntimeData>("/api/admin/runtime"),
        api.get<{ users: AdminUser[] }>("/api/admin/users"),
        api.get<{ ips: string[] }>("/api/admin/firewall"),
      ])
      setRuntime(rt)
      setUsers(u.users)
      setBlockedIps(fw.ips)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) setError("Доступ запрещён — требуется роль ADMIN")
        else setError(err.message)
      } else {
        setError("Не удалось загрузить данные администратора")
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { loadAll() }, [loadAll])

  const handleBan = async (userId: string) => {
    if (!confirm("Заблокировать пользователя?")) return
    try {
      await api.post(`/api/admin/users/${userId}/ban`)
      loadAll()
    } catch { setError("Ошибка бана") }
  }

  const handleBlockIp = async () => {
    if (!newIp.trim()) return
    try {
      await api.post("/api/admin/firewall", { ip: newIp.trim() })
      setNewIp("")
      loadAll()
    } catch { setError("Ошибка блокировки IP") }
  }

  const handleUnblockIp = async (ip: string) => {
    try {
      await api.delete("/api/admin/firewall", { ip })
      loadAll()
    } catch { setError("Ошибка разблокировки IP") }
  }

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return `${days}д ${hours}ч ${mins}м`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-text-muted">
        <Loader2 className="w-8 h-8 animate-spin mr-3" />
        <span className="text-body-md">Загрузка админ-панели...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-text-muted gap-4">
        <AlertCircle className="w-12 h-12 text-[#F43F5E]" />
        <p className="text-body-md text-[#F43F5E]">{error}</p>
        <Button variant="secondary" onClick={loadAll}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Повторить
        </Button>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <h1 className="text-display-sm">Администрирование</h1>
        <Button variant="secondary" onClick={loadAll}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Обновить
        </Button>
      </div>

      {/* Runtime Health */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                <Database className="w-5 h-5 text-text-muted" />
              </div>
              <div>
                <p className="text-caption text-text-muted">PostgreSQL</p>
                <Badge variant={runtime?.db === "ok" ? "active" : "error"} showDot>
                  {runtime?.db === "ok" ? "OK" : "Error"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                <Server className="w-5 h-5 text-text-muted" />
              </div>
              <div>
                <p className="text-caption text-text-muted">Redis</p>
                <Badge variant={runtime?.redis === "ok" ? "active" : "error"} showDot>
                  {runtime?.redis === "ok" ? "OK" : "Error"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-text-muted" />
              </div>
              <div>
                <p className="text-caption text-text-muted">Память</p>
                <p className="text-white font-semibold">
                  {runtime?.system.memoryUsed}MB / {runtime?.system.memoryTotal}MB
                </p>
                <p className="text-caption text-text-muted">{runtime?.system.memoryPercent}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                <HardDrive className="w-5 h-5 text-text-muted" />
              </div>
              <div>
                <p className="text-caption text-text-muted">Аптайм</p>
                <p className="text-white font-semibold">{formatUptime(runtime?.system.uptime ?? 0)}</p>
                <p className="text-caption text-text-muted">Задач: {runtime?.activeTasks}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Users Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Пользователи ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Потоки</TableHead>
                <TableHead>Аккаунтов</TableHead>
                <TableHead>Задач</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="w-[100px]">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium text-white">{user.email}</div>
                      {user.name && <div className="text-caption text-text-muted">{user.name}</div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.role === "ADMIN" ? "active" : "neutral"}>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>{user.maxThreads}</TableCell>
                  <TableCell>{user._count.accounts}</TableCell>
                  <TableCell>{user._count.tasks}</TableCell>
                  <TableCell>
                    {user.isBanned ? (
                      <Badge variant="error" showDot>Заблокирован</Badge>
                    ) : (
                      <Badge variant="active" showDot>Активен</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!user.isBanned && user.role !== "ADMIN" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[#F43F5E] hover:bg-[#F43F5E]/10"
                        onClick={() => handleBan(user.id)}
                      >
                        <Ban className="w-4 h-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* IP Firewall */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            IP Файрвол ({blockedIps.length} заблокировано)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Input
              placeholder="IP для блокировки (напр. 192.168.1.1)"
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              className="max-w-sm bg-white/[0.02]"
              onKeyDown={(e) => e.key === "Enter" && handleBlockIp()}
            />
            <Button variant="primary" onClick={handleBlockIp} disabled={!newIp.trim()}>
              <Plus className="w-4 h-4 mr-2" />
              Заблокировать
            </Button>
          </div>

          {blockedIps.length === 0 ? (
            <p className="text-text-muted text-body-sm py-4">Нет заблокированных IP</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {blockedIps.map((ip) => (
                <div
                  key={ip}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 text-body-sm font-mono"
                >
                  <span className="text-white">{ip}</span>
                  <button
                    className="text-text-muted hover:text-[#F43F5E] transition-colors"
                    onClick={() => handleUnblockIp(ip)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
