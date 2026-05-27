"use client"

import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { ShieldAlert } from "lucide-react"
import Link from "next/link"

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <EmptyState
          icon={<ShieldAlert className="w-16 h-16" />}
          title="Страница не найдена"
          description="Возможно, она была удалена или вы ввели неверный адрес."
          action={
            <Button asChild variant="primary">
              <Link href="/account/dashboard">На главную</Link>
            </Button>
          }
        />
      </div>
    </div>
  )
}
