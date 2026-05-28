"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"

export default function ResetPasswordPage() {
  const router = useRouter()
  const [loading, setLoading] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    
    // Placeholder logic for now
    setTimeout(() => {
      setSuccess(true)
      setLoading(false)
      setTimeout(() => router.push("/auth/sign-in"), 2000)
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
        <h1 className="text-display-md">Новый пароль</h1>
        <p className="text-body-md text-text-muted">
          Придумайте новый надежный пароль
        </p>
      </div>

      {success ? (
        <div className="text-center space-y-6">
          <div className="bg-[#00D287]/10 border border-[#00D287]/20 text-[#00D287] p-4 rounded-card-base text-body-sm">
            Пароль успешно изменен. Перенаправление...
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="password">Новый пароль</Label>
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
            {loading ? "Сохранение..." : "Сохранить пароль"}
          </Button>
        </form>
      )}
    </motion.div>
  )
}

