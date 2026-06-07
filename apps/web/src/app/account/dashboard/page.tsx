"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { StatCard } from "@/components/ui/stat-card"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Users, Eye, PlaySquare, Shield, Activity, Loader2 } from "lucide-react"
import { api } from "@/lib/api"

interface DashboardStats {
  totalAccounts: number
  activeAccounts: number
  bannedAccounts: number
  warmingUp: number
  totalVideos: number
  uploadedVideos: number
  proxies: number
}

interface ActivityItem {
  id: string
  type: string
  text: string
  time: string
}

export default function DashboardPage() {
  const [stats, setStats] = React.useState<DashboardStats | null>(null)
  const [activity, setActivity] = React.useState<ActivityItem[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true)
        // Load accounts for stats
        const [accountsRes, videosRes] = await Promise.allSettled([
          api.get<{ accounts: any[] }>("/api/accounts"),
          api.get<{ videos: any[] }>("/api/videos"),
        ])

        const accounts = accountsRes.status === "fulfilled" ? accountsRes.value.accounts : []
        const videos = videosRes.status === "fulfilled" ? videosRes.value.videos : []

        setStats({
          totalAccounts: accounts.length,
          activeAccounts: accounts.filter((a: any) => a.status === "ALIVE").length,
          bannedAccounts: accounts.filter((a: any) => a.status === "BANNED").length,
          warmingUp: accounts.filter((a: any) => a.status === "WARMING_UP").length,
          totalVideos: videos.length,
          uploadedVideos: videos.filter((v: any) => v.isUploaded).length,
          proxies: 0,
        })

        // Generate activity from accounts data
        const recentActivity: ActivityItem[] = accounts
          .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 5)
          .map((a: any, i: number) => ({
            id: String(i),
            type: a.status === "BANNED" ? "error" : a.status === "WARMING_UP" ? "info" : "success",
            text: `${a.username || a.id.slice(0, 8)} — ${a.status}`,
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

  // Chart data — will be replaced with analytics API when available
  const chartData = [
    { date: "01", views: 0, interactions: 0 },
    { date: "02", views: 0, interactions: 0 },
    { date: "03", views: 0, interactions: 0 },
    { date: "04", views: 0, interactions: 0 },
    { date: "05", views: 0, interactions: 0 },
    { date: "06", views: 0, interactions: 0 },
    { date: "07", views: 0, interactions: 0 },
  ]

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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          label="Всего аккаунтов"
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
          label="Видео загружено"
          value={`${stats?.uploadedVideos ?? 0}/${stats?.totalVideos ?? 0}`}
          icon={Eye}
          trend={{ value: 0, label: "" }}
        />
        <StatCard
          label="Забанено"
          value={String(stats?.bannedAccounts ?? 0)}
          icon={Shield}
          trend={{ value: 0, label: "" }}
        />
      </div>

      {/* Charts + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Активность за неделю</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" stroke="#9ca3af" />
                  <YAxis stroke="#9ca3af" />
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
                <div
                  key={item.id}
                  className="flex items-start gap-3 text-body-sm"
                >
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
    </motion.div>
  )
}
