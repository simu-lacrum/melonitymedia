"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { api } from "@/lib/api"

export default function SignInPage() {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState("")

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const login = formData.get("login") as string
    const password = formData.get("password") as string

    try {
      await api.post("/api/auth/login", { login, password })
      router.push("/account/dashboard")
    } catch (err: any) {
      setError(err.message || "Ошибка авторизации")
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="liquid-glass-elevated p-10 flex flex-col space-y-8"
    >
      <div className="text-center space-y-2">
        <h1 className="text-display-md">Вход в систему</h1>
        <p className="text-body-md text-text-muted">
          Добро пожаловать в MelonityMedia
        </p>
      </div>

      {error && (
        <div className="bg-[#F43F5E]/10 border border-[#F43F5E]/20 text-[#F43F5E] p-3 rounded-card-base text-body-sm text-center">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          <div>
            <Label htmlFor="login">Логин (Email или Username)</Label>
            <Input id="login" name="login" required disabled={loading} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="password" className="mb-0">Пароль</Label>
              <Link
                href="/auth/forgot-password"
                className="text-body-sm text-melon-pink hover:text-[#FF6B8B] transition-colors"
              >
                Забыли пароль?
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              required
              disabled={loading}
            />
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <Checkbox id="remember" name="remember" disabled={loading} />
          <Label htmlFor="remember" className="mb-0 text-body-md">
            Запомнить меня
          </Label>
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? "Вход..." : "Войти"}
        </Button>
      </form>

      <div className="text-center text-body-sm text-text-muted">
        Нет аккаунта?{" "}
        <Link
          href="/auth/sign-up"
          className="text-melon-pink hover:text-[#FF6B8B] transition-colors"
        >
          Зарегистрироваться
        </Link>
      </div>
    </motion.div>
  )
}
