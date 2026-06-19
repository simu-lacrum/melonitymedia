"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import {
  Server, Database, HardDrive, Cpu, Shield, Users, Ban,
  Loader2, RefreshCw, Plus, Trash2, AlertCircle, CheckCircle, XCircle, Undo2
} from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { toast } from "sonner"

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
  isApproved: boolean
  approvedAt?: string
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
      toast.success("Пользователь заблокирован")
      loadAll()
    } catch { toast.error("Ошибка бана") }
  }

  const handleUnban = async (userId: string) => {
    try {
      await api.post(`/api/admin/users/${userId}/unban`)
      toast.success("Пользователь разблокирован")
      loadAll()
    } catch { toast.error("Ошибка разблокировки") }
  }

  const handleApprove = async (userId: string) => {
    try {
      await api.post(`/api/admin/users/${userId}/approve`)
      toast.success("Доступ одобрен")
      loadAll()
    } catch { toast.error("Ошибка одобрения") }
  }

  const handleRevoke = async (userId: string) => {
    if (!confirm("Отозвать доступ у пользователя? Все его задачи будут отменены.")) return
    try {
      await api.post(`/api/admin/users/${userId}/revoke`)
      toast.success("Доступ отозван")
      loadAll()
    } catch { toast.error("Ошибка отзыва доступа") }
  }

  const handleBlockIp = async () => {
    if (!newIp.trim()) return
    try {
      await api.post("/api/admin/firewall", { ip: newIp.trim() })
      toast.success(`IP ${newIp.trim()} заблокирован`)
      setNewIp("")
      loadAll()
    } catch { toast.error("Ошибка блокировки IP") }
  }

  const handleUnblockIp = async (ip: string) => {
    try {
      await api.post("/api/admin/firewall/unblock", { ip })
      toast.success(`IP ${ip} разблокирован`)
      loadAll()
    } catch { toast.error("Ошибка разблокировки IP") }
  }

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return `${days}д ${hours}ч ${mins}м`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-muted-foreground">
        <Loader2 className="size-8 animate-spin mr-3" />
        <span className="text-sm">Загрузка админ-панели...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-4">
        <AlertCircle className="size-12 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={loadAll}>
          <RefreshCw className="size-4 mr-2" />
          Повторить
        </Button>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="flex flex-col gap-8"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Администрирование</h1>
          <p className="text-sm text-muted-foreground mt-1">Мониторинг системы и управление пользователями</p>
        </div>
        <Button variant="outline" onClick={loadAll}>
          <RefreshCw className="size-4 mr-2" />
          Обновить
        </Button>
      </div>

      {/* Runtime Health */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-accent flex items-center justify-center">
                <Database className="size-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">PostgreSQL</p>
                <Badge variant={runtime?.db === "ok" ? "default" : "destructive"}>
                  {runtime?.db === "ok" ? "OK" : "Error"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-accent flex items-center justify-center">
                <Server className="size-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Redis</p>
                <Badge variant={runtime?.redis === "ok" ? "default" : "destructive"}>
                  {runtime?.redis === "ok" ? "OK" : "Error"}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-accent flex items-center justify-center">
                <Cpu className="size-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Память</p>
                <p className="text-sm font-semibold text-foreground">
                  {runtime?.system.memoryUsed}MB / {runtime?.system.memoryTotal}MB
                </p>
                <Progress value={runtime?.system.memoryPercent ?? 0} className="mt-1.5 h-1.5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-accent flex items-center justify-center">
                <HardDrive className="size-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Аптайм</p>
                <p className="text-sm font-semibold text-foreground">{formatUptime(runtime?.system.uptime ?? 0)}</p>
                <p className="text-xs text-muted-foreground">Задач: {runtime?.activeTasks}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Users */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="size-4" />
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
                      <div className="font-medium text-foreground">{user.email}</div>
                      {user.name && <div className="text-xs text-muted-foreground">{user.name}</div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
                      {user.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{user.maxThreads}</TableCell>
                  <TableCell className="text-sm">{user._count.accounts}</TableCell>
                  <TableCell className="text-sm">{user._count.tasks}</TableCell>
                  <TableCell>
                    {user.isBanned ? (
                      <Badge variant="destructive">Заблокирован</Badge>
                    ) : !user.isApproved ? (
                      <Badge variant="outline" className="border-amber-500 text-amber-500">Ожидает</Badge>
                    ) : (
                      <Badge variant="default">Активен</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {/* Pending approval → show Approve button */}
                      {!user.isApproved && !user.isBanned && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10"
                          onClick={() => handleApprove(user.id)}
                          title="Одобрить"
                        >
                          <CheckCircle className="size-4" />
                        </Button>
                      )}
                      {/* Approved non-admin → show Revoke + Ban */}
                      {user.isApproved && user.role !== "ADMIN" && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                            onClick={() => handleRevoke(user.id)}
                            title="Отозвать доступ"
                          >
                            <XCircle className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleBan(user.id)}
                            title="Заблокировать"
                          >
                            <Ban className="size-4" />
                          </Button>
                        </>
                      )}
                      {/* Banned → show Unban */}
                      {user.isBanned && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-blue-500 hover:text-blue-600 hover:bg-blue-500/10"
                          onClick={() => handleUnban(user.id)}
                          title="Разблокировать"
                        >
                          <Undo2 className="size-4" />
                        </Button>
                      )}
                    </div>
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
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="size-4" />
            IP Файрвол ({blockedIps.length} заблокировано)
          </CardTitle>
          <CardDescription>Управление заблокированными IP-адресами</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Input
              placeholder="IP для блокировки (напр. 192.168.1.1)"
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              className="max-w-sm"
              onKeyDown={(e) => e.key === "Enter" && handleBlockIp()}
            />
            <Button onClick={handleBlockIp} disabled={!newIp.trim()}>
              <Plus className="size-4 mr-2" />
              Заблокировать
            </Button>
          </div>

          {blockedIps.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">Нет заблокированных IP</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {blockedIps.map((ip) => (
                <Badge key={ip} variant="secondary" className="gap-2 py-1.5 px-3 font-mono text-xs">
                  {ip}
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => handleUnblockIp(ip)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
