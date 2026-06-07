"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, CheckCircle } from "lucide-react"
import Link from "next/link"

export default function ForgotPasswordPage() {
  const [loading, setLoading] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setTimeout(() => {
      setSuccess(true)
      setLoading(false)
    }, 1000)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
    >
      <Card className="w-full">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-2xl font-semibold">Сброс пароля</CardTitle>
          <CardDescription>Введите ваш email для сброса пароля</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {success ? (
            <div className="flex flex-col gap-6">
              <Alert>
                <CheckCircle className="size-4" />
                <AlertDescription>
                  Инструкции по сбросу пароля отправлены на ваш email.
                </AlertDescription>
              </Alert>
              <Button render={<Link href="/auth/sign-in" />} className="w-full" size="lg">
                Вернуться ко входу
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required disabled={loading} autoFocus />
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Отправка...
                  </>
                ) : (
                  "Сбросить пароль"
                )}
              </Button>

              <div className="text-center text-sm text-muted-foreground">
                Вспомнили пароль?{" "}
                <Link href="/auth/sign-in" className="text-primary hover:text-primary/80 transition-colors font-medium">
                  Войти
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
