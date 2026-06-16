"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Users, Eye, PlaySquare, Shield, Activity, Loader2, Zap, Clock, AlertTriangle, TrendingUp } from "lucide-react"
import { api } from "@/lib/api"
import { toast } from "sonner"

interface DashboardStats {
  totalAccounts: number
  activeAccounts: number
  bannedAccounts: number
  warmingUp: number
  shadowbanned: number
  totalVideos: number
  uploadedVideos: number
  proxies: number
  totalViews: number
  totalFollowers: number
}

interface ActiveTask {
  id: string
  type: string
  status: string
  createdAt: string
}

interface ActivityItem {
  id: string
  type: string
  text: string
  time: string
}

interface ChartPoint {
  date: string
  views: number
  interactions: number
}

const STAT_ICONS = {
  accounts: Users,
  warming: PlaySquare,
  views: Eye,
  videos: PlaySquare,
  proxies: Shield,
  banned: AlertTriangle,
} as const

export default function DashboardPage() {
  const [stats, setStats] = React.useState<DashboardStats | null>(null)
  const [activity, setActivity] = React.useState<ActivityItem[]>([])
  const [activeTasks, setActiveTasks] = React.useState<ActiveTask[]>([])
  const [chartData, setChartData] = React.useState<ChartPoint[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true)
        const [accountsRes, videosRes, analyticsRes, tasksRes, proxiesRes] = await Promise.allSettled([
          api.get<{ accounts: any[] }>("/api/accounts"),
          api.get<{ videos: any[] }>("/api/videos"),
          api.get<{ totalViews: number; aliveAccounts: number; totalFollowers: number; uploadedVideos: number }>("/api/analytics/summary"),
          api.get<{ tasks: ActiveTask[] }>("/api/analytics/active-tasks"),
          api.get<{ proxies: any[] }>("/api/proxies"),
        ])

        const accounts = accountsRes.status === "fulfilled" ? accountsRes.value.accounts : []
        const videos = videosRes.status === "fulfilled" ? videosRes.value.videos : []
        const analytics = analyticsRes.status === "fulfilled" ? analyticsRes.value : null
        const tasks = tasksRes.status === "fulfilled" ? tasksRes.value.tasks : []
        const proxies = proxiesRes.status === "fulfilled" ? proxiesRes.value.proxies : []

        setActiveTasks(tasks)
        setStats({
          totalAccounts: accounts.length,
          activeAccounts: accounts.filter((a: any) => a.status === "ALIVE").length,
          bannedAccounts: accounts.filter((a: any) => a.status === "BANNED").length,
          warmingUp: accounts.filter((a: any) => a.status === "WARMING_UP").length,
          shadowbanned: accounts.filter((a: any) => a.status === "SHADOWBAN_SUSPECTED").length,
          totalVideos: videos.length,
          uploadedVideos: analytics?.uploadedVideos ?? videos.filter((v: any) => v.isUploaded).length,
          proxies: proxies.length,
          totalViews: analytics?.totalViews ?? 0,
          totalFollowers: analytics?.totalFollowers ?? 0,
        })

        // Build chart data
        const dayMap = new Map<string, { views: number; interactions: number }>()
        const now = new Date()
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now)
          d.setDate(d.getDate() - i)
          const key = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
          dayMap.set(key, { views: 0, interactions: 0 })
        }
        accounts.forEach((a: any) => {
          const created = new Date(a.createdAt)
          const key = created.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
          if (dayMap.has(key)) {
            const entry = dayMap.get(key)!
            entry.views += a.views ?? 0
            entry.interactions += a.likes ?? 0
          }
        })
        setChartData(Array.from(dayMap.entries()).map(([date, data]) => ({ date, ...data })))

        // Activity feed
        setActivity(
          accounts
            .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .slice(0, 5)
            .map((a: any, i: number) => ({
              id: String(i),
              type: a.status === "BANNED" ? "error" : a.status === "WARMING_UP" ? "info" : a.status === "SHADOWBAN_SUSPECTED" ? "warning" : "success",
              text: `${a.username || a.id.slice(0, 8)} — ${statusLabel(a.status)}`,
              time: timeAgo(a.updatedAt),
            }))
        )
      } catch (err) {
        toast.error("Ошибка загрузки дашборда")
      } finally {
        setLoading(false)
      }
    }
    loadDashboard()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  const statCards = [
    { key: "accounts", label: "Аккаунты", value: String(stats?.totalAccounts ?? 0), sub: `${stats?.activeAccounts ?? 0} активных`, icon: Users },
    { key: "warming", label: "На прогреве", value: String(stats?.warmingUp ?? 0), sub: "", icon: PlaySquare },
    { key: "views", label: "Просмотры", value: formatNumber(stats?.totalViews ?? 0), sub: `${stats?.totalFollowers ?? 0} подписчиков`, icon: Eye },
    { key: "videos", label: "Видео", value: `${stats?.uploadedVideos ?? 0}/${stats?.totalVideos ?? 0}`, sub: "загружено", icon: TrendingUp },
    { key: "proxies", label: "Прокси", value: String(stats?.proxies ?? 0), sub: "", icon: Shield },
    { key: "banned", label: "Забанено", value: String(stats?.bannedAccounts ?? 0), sub: `${stats?.shadowbanned ?? 0} шэдоубан`, icon: AlertTriangle },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className="flex flex-col gap-8"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Обзор панели</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map((s, i) => (
          <Card key={s.key} className="stagger-enter">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{s.label}</span>
                <s.icon className="size-4 text-muted-foreground" />
              </div>
              <div className="text-2xl font-bold tracking-tight">{s.value}</div>
              {s.sub && <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts + Tasks + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Активность за неделю</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      color: "var(--foreground)",
                    }}
                  />
                  <Area type="monotone" dataKey="views" stroke="var(--chart-1)" fill="rgba(255, 20, 105, 0.1)" strokeWidth={2} name="Просмотры" />
                  <Area type="monotone" dataKey="interactions" stroke="var(--chart-2)" fill="rgba(21, 193, 136, 0.1)" strokeWidth={2} name="Взаимодействия" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          {/* Active Tasks */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                Активные задачи
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 max-h-[340px] overflow-y-auto">
              {activeTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет активных задач</p>
              ) : (
                activeTasks.map((task) => (
                  <div key={task.id} className="flex items-center justify-between p-3 rounded-lg bg-accent/50 border border-border">
                    <div className="flex items-center gap-3">
                      <div className={`size-2 rounded-full shrink-0 ${task.status === "RUNNING" ? "bg-green-500 animate-pulse" : "bg-yellow-500"}`} />
                      <div>
                        <p className="text-sm font-medium">{taskTypeLabel(task.type)}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="size-3" />
                          {timeAgo(task.createdAt)}
                        </p>
                      </div>
                    </div>
                    <Badge variant={task.status === "RUNNING" ? "default" : "secondary"}>
                      {task.status === "RUNNING" ? "В работе" : "Ожидание"}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="size-4" />
                Последняя активность
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">Нет данных</p>
              ) : (
                activity.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 text-sm">
                    <div className={`size-2 mt-1.5 rounded-full shrink-0 ${
                      item.type === "success" ? "bg-green-500"
                      : item.type === "warning" ? "bg-yellow-500"
                      : item.type === "error" ? "bg-destructive"
                      : "bg-blue-400"
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground truncate">{item.text}</p>
                      <p className="text-xs text-muted-foreground">{item.time}</p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </motion.div>
  )
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ALIVE: "Активен", BANNED: "Забанен", WARMING_UP: "Прогрев",
    SHADOWBAN_SUSPECTED: "Шэдоубан", DEAD: "Мёртв", COOLDOWN: "Кулдаун",
  }
  return map[status] || status
}

function taskTypeLabel(type: string): string {
  const map: Record<string, string> = {
    UPLOAD: "Залив видео", WARMUP: "Прогрев", COOKIES: "Сбор cookies",
    EDIT_PROFILE: "Ред. профиля", LOGIN: "Логин",
  }
  return map[type] || type
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "сейчас"
  if (mins < 60) return `${mins} мин назад`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ч назад`
  return `${Math.floor(hours / 24)} дн назад`
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
