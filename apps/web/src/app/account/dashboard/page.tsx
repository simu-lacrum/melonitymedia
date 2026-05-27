"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { StatCard } from "@/components/ui/stat-card"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Users, Eye, PlaySquare, Shield, Activity } from "lucide-react"

const data = [
  { date: "01", views: 4000, interactions: 2400 },
  { date: "02", views: 3000, interactions: 1398 },
  { date: "03", views: 2000, interactions: 9800 },
  { date: "04", views: 2780, interactions: 3908 },
  { date: "05", views: 1890, interactions: 4800 },
  { date: "06", views: 2390, interactions: 3800 },
  { date: "07", views: 3490, interactions: 4300 },
]

const recentActivity = [
  { id: 1, type: "success", text: "TikTok аккаунт @user123 успешно авторизован", time: "2 мин назад" },
  { id: 2, type: "warning", text: "Прокси 192.168.1.1:8080 медленно отвечает", time: "15 мин назад" },
  { id: 3, type: "error", text: "YouTube аккаунт @yt_test заблокирован", time: "1 час назад" },
  { id: 4, type: "info", text: "Запущена задача 'Прогрев новых аккаунтов'", time: "3 часа назад" },
]

export default function DashboardPage() {
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
          value="1,284"
          icon={Users}
          trend={{ value: 12, label: "за неделю" }}
        />
        <StatCard
          label="Активных сессий"
          value="892"
          icon={PlaySquare}
          trend={{ value: 5, label: "за неделю" }}
        />
        <StatCard
          label="Просмотры (24ч)"
          value="45.2K"
          icon={Eye}
          trend={{ value: -2, label: "вчера" }}
        />
        <StatCard
          label="Рабочие прокси"
          value="124"
          icon={Shield}
          trend={{ value: 0, label: "стабильно" }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle>Динамика просмотров</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#FF1469" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#FF1469" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value / 1000}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'rgba(20,20,20,0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Area type="monotone" dataKey="views" stroke="#FF1469" strokeWidth={3} fillOpacity={1} fill="url(#colorViews)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle>Активность</CardTitle>
            <Activity className="w-5 h-5 text-text-muted" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start space-x-3">
                  <div className="mt-1 flex-shrink-0">
                    <Badge
                      variant={
                        activity.type === "success" ? "active" :
                        activity.type === "warning" ? "warning" :
                        activity.type === "error" ? "error" : "neutral"
                      }
                      showDot
                      className="px-1.5"
                    />
                  </div>
                  <div>
                    <p className="text-body-sm text-white line-clamp-2">{activity.text}</p>
                    <span className="text-caption text-text-muted">{activity.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  )
}
