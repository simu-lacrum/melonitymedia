"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"

export default function ForgotPasswordPage() {
  const [loading, setLoading] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    
    // Placeholder logic for now
    setTimeout(() => {
      setSuccess(true)
      setLoading(false)
    }, 1000)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="liquid-glass p-10 flex flex-col space-y-8"
    >
      <div className="text-center space-y-2">
        <h1 className="text-display-md">Сброс пароля</h1>
        <p className="text-body-md text-text-muted">
          Введите ваш email для сброса пароля
        </p>
      </div>

      {success ? (
        <div className="text-center space-y-6">
          <div className="bg-[#00D287]/10 border border-[#00D287]/20 text-[#00D287] p-4 rounded-card-base text-body-sm">
            Инструкции по сбросу пароля отправлены на ваш email.
          </div>
          <Button asChild className="w-full" size="lg">
            <Link href="/auth/sign-in">Вернуться ко входу</Link>
          </Button>
        </div>
      ) : (
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
          </div>

          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? "Отправка..." : "Сбросить пароль"}
          </Button>

          <div className="text-center text-body-sm text-text-muted">
            Вспомнили пароль?{" "}
            <Link
              href="/auth/sign-in"
              className="text-melon-pink hover:text-[#FF6B8B] transition-colors"
            >
              Войти
            </Link>
          </div>
        </form>
      )}
    </motion.div>
  )
}

