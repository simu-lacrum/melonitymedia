"use client"

import * as React from "react"
import { useRouter, usePathname } from "next/navigation"
import { api } from "@/lib/api"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import Link from "next/link"
import { motion } from "framer-motion"
import { LogOut, Home, Users, Shield, Server, Settings, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { io, Socket } from "socket.io-client"

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    api.get("/api/auth/me")
      .then((data) => {
        setUser(data)
        setLoading(false)
      })
      .catch((err) => {
        // Use window.location for hard redirect — ensures layout unmounts
        // and loading spinner doesn't persist
        if (err?.body?.pendingApproval) {
          window.location.href = "/auth/sign-in"
        } else {
          window.location.href = "/auth/sign-in"
        }
      })
  }, [])

  // ── Global worker error listener ──────────────────────────
  // Listens for structured error events from ALL worker handlers
  // (upload, warmup, login, edit-profile, cookies, analytics, etc.)
  React.useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"
    const origin = apiUrl.replace(/\/api\/?$/, "") || apiUrl
    const socket: Socket = io(`${origin}/logs`, {
      withCredentials: true,
      transports: ["websocket"],
    })

    interface WorkerErrorEvent {
      accountId: string
      handler: string
      code: string
      title: string
      message: string
      advice: string
      detail?: string
      timestamp: string
    }

    const handlerLabels: Record<string, string> = {
      upload: "Загрузка видео",
      warmup: "Прогрев",
      login: "Вход в аккаунт",
      "edit-profile": "Редактирование профиля",
      cookies: "Обновление cookies",
      analytics: "Сбор аналитики",
      shadowban: "Проверка shadowban",
      cleanup: "Очистка файлов",
    }

    socket.on("worker:error", (data: WorkerErrorEvent) => {
      const label = handlerLabels[data.handler] || data.handler
      toast.error(data.title, {
        description: `${data.message}\n\n💡 ${data.advice}`,
        duration: 12000,
        action: {
          label: "Подробнее",
          onClick: () => {
            toast.info(`[${label}] ${data.detail || data.message}`, {
              duration: 20000,
            })
          },
        },
      })
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  const handleLogout = async () => {
    try {
      await api.post("/api/auth/logout")
      toast.success("Вы вышли из системы")
      router.push("/auth/sign-in")
    } catch (err) {
      toast.error("Ошибка при выходе")
    }
  }

  const initials = React.useMemo(() => {
    const name = user?.user?.name || user?.user?.email || ""
    return name.slice(0, 2).toUpperCase()
  }, [user])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="size-8 text-primary animate-spin" />
      </div>
    )
  }

  const navItems = [
    { href: "/account/dashboard", icon: Home, label: "Дашборд" },
    { href: "/account/accounts", icon: Users, label: "Аккаунты" },
    { href: "/account/proxies", icon: Shield, label: "Прокси" },
    { href: "/account/workspace", icon: Server, label: "Воркспейс" },
    { href: "/account/settings", icon: Settings, label: "Настройки" },
    ...(user?.user?.role === "ADMIN"
      ? [{ href: "/account/admin", icon: Shield, label: "Админ" }]
      : []),
  ]

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top Navigation — glassmorphism header */}
      <header className="sticky top-0 z-50 panel-header-glass px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/account/dashboard" className="flex items-center gap-3">
            <img src="/logo.svg" alt="MelonityMedia" width="28" height="28" />
            <span className="text-sm font-semibold tracking-wide text-foreground uppercase">
              Melonity<span className="text-primary">Media</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative px-4 py-2 text-sm font-medium rounded-lg transition-colors duration-150 ${
                    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeNav"
                      className="absolute inset-0 bg-accent rounded-lg"
                      transition={{ type: "spring", duration: 0.35, bounce: 0.12 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-2">
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                  </span>
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium text-foreground">{user?.user?.name || user?.user?.email}</div>
              <div className="text-xs text-muted-foreground">{user?.user?.email}</div>
            </div>
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
          </div>
          <Separator orientation="vertical" className="h-6 hidden sm:block" />
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon" onClick={handleLogout} className="text-destructive hover:text-destructive hover:bg-destructive/10" />}
            >
              <LogOut className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Выйти</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  )
}
