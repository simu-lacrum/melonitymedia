import * as React from "react"
import { cn } from "@/lib/utils"

export interface ToggleProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {}

const Toggle = React.forwardRef<HTMLInputElement, ToggleProps>(
  ({ className, ...props }, ref) => {
    return (
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          ref={ref}
          {...props}
        />
        <div
          className={cn(
            "w-11 h-6 bg-white/10 rounded-full peer peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-melon-pink peer-focus-visible:ring-offset-2 peer-checked:bg-melon-pink transition-colors peer-disabled:cursor-not-allowed peer-disabled:opacity-50 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full peer-checked:after:border-white",
            className
          )}
        ></div>
      </label>
    )
  }
)
Toggle.displayName = "Toggle"

export { Toggle }
