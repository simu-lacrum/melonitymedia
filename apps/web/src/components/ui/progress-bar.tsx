import * as React from "react"
import { cn } from "@/lib/utils"

interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // 0 to 100
}

export function ProgressBar({ value, className, ...props }: ProgressBarProps) {
  const safeValue = Math.min(Math.max(value, 0), 100)
  
  return (
    <div
      className={cn("w-full h-1 bg-white/10 rounded-full overflow-hidden", className)}
      {...props}
    >
      <div
        className="h-full bg-gradient-to-r from-[#FF1469] to-[#FF6B8B] rounded-full transition-all duration-500 ease-out"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  )
}
