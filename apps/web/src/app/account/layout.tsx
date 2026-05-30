"use client"

import * as React from "react"
import { useRouter, usePathname } from "next/navigation"
import { api } from "@/lib/api"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { motion } from "framer-motion"
import { LogOut, Home, Users, Shield, Server, Settings } from "lucide-react"

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
      .catch(() => {
        router.push("/auth/sign-in")
      })
  }, [router])

  const handleLogout = async () => {
    try {
      await api.post("/api/auth/logout")
      router.push("/auth/sign-in")
    } catch (err) {
      console.error(err)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-melon-pink border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const navItems = [
    { href: "/account/dashboard", icon: Home, label: "Дашборд" },
    { href: "/account/accounts", icon: Users, label: "Аккаунты" },
    { href: "/account/proxies", icon: Shield, label: "Прокси" },
    { href: "/account/workspace", icon: Server, label: "Воркспейс" },
    { href: "/account/settings", icon: Settings, label: "Настройки" },
    // Admin link — only shown for ADMIN role
    ...(user?.user?.role === "ADMIN"
      ? [{ href: "/account/admin", icon: Shield, label: "Админ" }]
      : []),
  ]

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-50 liquid-glass border-b border-white/5 px-6 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-8">
          <Link href="/account/dashboard" className="text-heading-md text-white">
            Melonity<span className="text-melon-pink">Media</span>
          </Link>
          
          <nav className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative px-4 py-2 text-body-sm font-medium rounded-pill transition-colors ${
                    isActive ? "text-white" : "text-text-muted hover:text-white hover:bg-white/5"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeNav"
                      className="absolute inset-0 bg-white/10 rounded-pill"
                      transition={{ type: "spring", stiffness: 300, damping: 25 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center space-x-2">
                    <item.icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </span>
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3 text-right">
            <div className="hidden sm:block">
              <div className="text-body-sm font-medium">{user?.user?.name || user?.user?.email}</div>
              <div className="text-caption text-text-muted">{user?.user?.email}</div>
            </div>
            <Avatar size="sm" />
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="Выход">
            <LogOut className="w-5 h-5 text-status-error" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  )
}

