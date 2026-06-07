"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { StatCard } from "@/components/ui/stat-card"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Users, Eye, PlaySquare, Shield, Activity, Loader2, Zap, Clock, AlertTriangle } from "lucide-react"
import { api } from "@/lib/api"

interface DashboardStats {
  totalAccounts: number
  activeAccounts: number
  bannedAccounts: number
  warmingUp: number
  shadowbanned: number
  totalVideos: number
  uploadedVideos: number
  proxies: number
  // Analytics API
  totalViews: number
  totalFollowers: number
}

interface ActiveTask {
  id: string
  type: string
  status: string
  createdAt: string
  config?: any
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

        // Build chart data from accounts creation dates (aggregate by day)
        const dayMap = new Map<string, { views: number; interactions: number }>()
        const now = new Date()
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now)
          d.setDate(d.getDate() - i)
          const key = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
          dayMap.set(key, { views: 0, interactions: 0 })
        }

        // Distribute account views across chart days
        accounts.forEach((a: any) => {
          const created = new Date(a.createdAt)
          const key = created.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })
          if (dayMap.has(key)) {
            const entry = dayMap.get(key)!
            entry.views += a.views ?? 0
            entry.interactions += a.likes ?? 0
          }
        })

        setChartData(Array.from(dayMap.entries()).map(([date, data]) => ({
          date, views: data.views, interactions: data.interactions,
        })))

        // Generate activity from accounts data
        const recentActivity: ActivityItem[] = accounts
          .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 5)
          .map((a: any, i: number) => ({
            id: String(i),
            type: a.status === "BANNED" ? "error" : a.status === "WARMING_UP" ? "info" : a.status === "SHADOWBAN_SUSPECTED" ? "warning" : "success",
            text: `${a.username || a.id.slice(0, 8)} — ${statusLabel(a.status)}`,
            time: timeAgo(a.updatedAt),
          }))
        setActivity(recentActivity)
      } catch (err) {
        console.error("Dashboard load error:", err)
      } finally {
        setLoading(false)
      }
    }
    loadDashboard()
  }, [])

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "сейчас"
    if (mins < 60) return `${mins} мин назад`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} ч назад`
    const days = Math.floor(hours / 24)
    return `${days} дн назад`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-text-muted">
        <Loader2 className="w-8 h-8 animate-spin mr-3" />
        <span className="text-body-md">Загрузка панели...</span>
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
        <h1 className="text-display-sm">Обзор панели</h1>
      </div>

      {/* Stats Grid — 6 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          label="Аккаунты"
          value={String(stats?.totalAccounts ?? 0)}
          icon={Users}
          trend={{ value: stats?.activeAccounts ?? 0, label: "активных" }}
        />
        <StatCard
          label="На прогреве"
          value={String(stats?.warmingUp ?? 0)}
          icon={PlaySquare}
          trend={{ value: 0, label: "" }}
        />
        <StatCard
          label="Просмотры"
          value={formatNumber(stats?.totalViews ?? 0)}
          icon={Eye}
          trend={{ value: stats?.totalFollowers ?? 0, label: "подписчиков" }}
        />
        <StatCard
          label="Видео"
          value={`${stats?.uploadedVideos ?? 0}/${stats?.totalVideos ?? 0}`}
          icon={PlaySquare}
          trend={{ value: 0, label: "загружено" }}
        />
        <StatCard
          label="Прокси"
          value={String(stats?.proxies ?? 0)}
          icon={Shield}
          trend={{ value: 0, label: "" }}
        />
        <StatCard
          label="Забанено"
          value={String(stats?.bannedAccounts ?? 0)}
          icon={AlertTriangle}
          trend={{ value: stats?.shadowbanned ?? 0, label: "шэдоубан" }}
        />
      </div>

      {/* Charts + Tasks + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Активность за неделю</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: "#262a30",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "12px",
                      color: "#fff",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="views"
                    stroke="#ff1469"
                    fill="rgba(255, 20, 105, 0.1)"
                    strokeWidth={2}
                    name="Просмотры"
                  />
                  <Area
                    type="monotone"
                    dataKey="interactions"
                    stroke="#40D3F5"
                    fill="rgba(64, 211, 245, 0.1)"
                    strokeWidth={2}
                    name="Взаимодействия"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Right column: Tasks + Activity */}
        <div className="space-y-6">
          {/* Active Tasks (BullMQ) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-melon-pink" />
                Активные задачи
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activeTasks.length === 0 ? (
                <p className="text-text-muted text-body-sm">Нет активных задач</p>
              ) : (
                activeTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-3 bg-white/[0.02] rounded-lg border border-white/5"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        task.status === "RUNNING" ? "bg-[#00d287] animate-pulse" : "bg-[#f59e0b]"
                      }`} />
                      <div>
                        <p className="text-body-sm text-white font-medium">{taskTypeLabel(task.type)}</p>
                        <p className="text-caption text-text-muted flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {timeAgo(task.createdAt)}
                        </p>
                      </div>
                    </div>
                    <Badge variant={task.status === "RUNNING" ? "active" : "warning"} showDot>
                      {task.status === "RUNNING" ? "В работе" : "Ожидание"}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Последняя активность
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {activity.length === 0 ? (
                <p className="text-text-muted text-body-sm">Нет данных</p>
              ) : (
                activity.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 text-body-sm">
                    <div
                      className={`w-2 h-2 mt-1.5 rounded-full shrink-0 ${
                        item.type === "success"
                          ? "bg-[#00d287]"
                          : item.type === "warning"
                          ? "bg-[#f59e0b]"
                          : item.type === "error"
                          ? "bg-[#f43f5e]"
                          : "bg-[#40D3F5]"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-white truncate">{item.text}</p>
                      <p className="text-text-muted text-caption">{item.time}</p>
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
  switch (status) {
    case "ALIVE": return "Активен"
    case "BANNED": return "Забанен"
    case "WARMING_UP": return "Прогрев"
    case "SHADOWBAN_SUSPECTED": return "Шэдоубан"
    case "DEAD": return "Мёртв"
    case "COOLDOWN": return "Кулдаун"
    default: return status
  }
}

function taskTypeLabel(type: string): string {
  switch (type) {
    case "UPLOAD": return "Залив видео"
    case "WARMUP": return "Прогрев"
    case "COOKIES": return "Сбор cookies"
    case "EDIT_PROFILE": return "Ред. профиля"
    case "LOGIN": return "Логин"
    default: return type
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
