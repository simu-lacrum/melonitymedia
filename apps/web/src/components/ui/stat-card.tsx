import * as React from "react"
import { Card } from "./card"
import { LucideIcon } from "lucide-react"

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  trend?: {
    value: number
    label: string
  }
}

export function StatCard({ label, value, icon: Icon, trend }: StatCardProps) {
  return (
    <Card className="h-[160px] flex flex-col justify-between">
      <div className="flex items-center justify-between">
        <Icon className="w-6 h-6 text-ice-cyan" />
        <span className="text-caption text-text-muted">{label}</span>
      </div>
      <div>
        <div className="text-display-xl tracking-tight leading-none truncate">
          {value}
        </div>
        {trend && (
          <div className="mt-2 text-body-sm">
            <span
              className={
                trend.value > 0 ? "text-status-active" : "text-status-error"
              }
            >
              {trend.value > 0 ? "↑" : "↓"} {Math.abs(trend.value)}%
            </span>{" "}
            <span className="text-text-muted">{trend.label}</span>
          </div>
        )}
      </div>
    </Card>
  )
}
