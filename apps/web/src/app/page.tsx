"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      
      {/* Background decorations */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-melon-pink/20 rounded-full blur-[120px] pointer-events-none -z-10" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="text-center space-y-8 max-w-2xl"
      >
        <h1 className="text-[64px] font-bold leading-tight tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-white/50">
          Управляйте трафиком профессионально
        </h1>
        
        <p className="text-xl text-text-muted leading-relaxed">
          Премиальный инструмент для работы с YouTube Shorts и TikTok автоматизацией.
        </p>

        <div className="flex items-center justify-center space-x-4 pt-4">
          <Button asChild size="lg" variant="primary">
            <Link href="/auth/sign-in">Войти в панель</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/auth/sign-up">Регистрация</Link>
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
