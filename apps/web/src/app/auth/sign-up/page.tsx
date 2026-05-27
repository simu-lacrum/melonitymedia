"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { api } from "@/lib/api"

export default function SignUpPage() {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState("")

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get("email") as string
    const username = formData.get("username") as string
    const password = formData.get("password") as string
    const confirmPassword = formData.get("confirmPassword") as string

    if (password !== confirmPassword) {
      setError("Пароли не совпадают")
      setLoading(false)
      return
    }

    try {
      await api.post("/api/auth/register", { email, username, password })
      router.push("/account/dashboard")
    } catch (err: any) {
      setError(err.message || "Ошибка регистрации")
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
        <h1 className="text-display-md">Регистрация</h1>
        <p className="text-body-md text-text-muted">
          Создайте аккаунт MelonityMedia
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
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              disabled={loading}
            />
          </div>
          <div>
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              required
              disabled={loading}
            />
          </div>
          <div>
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              disabled={loading}
            />
          </div>
          <div>
            <Label htmlFor="confirmPassword">Подтвердите пароль</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              disabled={loading}
            />
          </div>
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? "Регистрация..." : "Зарегистрироваться"}
        </Button>
      </form>

      <div className="text-center text-body-sm text-text-muted">
        Уже есть аккаунт?{" "}
        <Link
          href="/auth/sign-in"
          className="text-melon-pink hover:text-[#FF6B8B] transition-colors"
        >
          Войти
        </Link>
      </div>
    </motion.div>
  )
}
