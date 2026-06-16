"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, AlertCircle, Clock } from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { api } from "@/lib/api"

export default function SignUpPage() {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState("")
  const [pendingApproval, setPendingApproval] = React.useState(false)

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
      const res = await api.post<{ pendingApproval?: boolean }>("/api/auth/register", { email, username, password })
      if (res.pendingApproval) {
        // Non-admin user → show pending message
        setPendingApproval(true)
      } else {
        // First user (admin) → auto-approved, redirect
        router.push("/account/dashboard")
      }
    } catch (err: any) {
      setError(err.message || "Ошибка регистрации")
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
    >
      <Card className="w-full">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-semibold">{pendingApproval ? "Заявка отправлена" : "Регистрация"}</CardTitle>
          <CardDescription>{pendingApproval ? "Ожидайте одобрения администратора" : "Создайте аккаунт MelonityMedia"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {pendingApproval ? (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="size-16 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Clock className="size-8 text-amber-500" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Ваш аккаунт успешно создан. Администратор должен одобрить вашу заявку, прежде чем вы сможете войти.
                </p>
              </div>
              <Link href="/auth/sign-in">
                <Button variant="outline">Перейти ко входу</Button>
              </Link>
            </div>
          ) : (
            <>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required disabled={loading} autoFocus />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="username">Username</Label>
                <Input id="username" name="username" required disabled={loading} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Пароль</Label>
                <Input id="password" name="password" type="password" required disabled={loading} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmPassword">Подтвердите пароль</Label>
                <Input id="confirmPassword" name="confirmPassword" type="password" required disabled={loading} />
              </div>
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Регистрация...
                </>
              ) : (
                "Зарегистрироваться"
              )}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            Уже есть аккаунт?{" "}
            <Link href="/auth/sign-in" className="text-primary hover:text-primary/80 transition-colors font-medium">
              Войти
            </Link>
          </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
