"use client";

import * as React from "react"
import { cn } from "@/lib/utils"

export interface SliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  value?: number;
  min?: number;
  max?: number;
  onValueChange?: (value: number) => void;
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, min = 0, max = 100, onValueChange, ...props }, ref) => {
    const percentage = value !== undefined ? ((value - min) / (max - min)) * 100 : 50;

    return (
      <div className={cn("relative w-full h-1 flex items-center group", className)}>
        {/* Track */}
        <div className="absolute w-full h-1 liquid-glass rounded-full overflow-hidden">
          {/* Fill */}
          <div
            className="absolute h-full bg-gradient-to-r from-[#FF2877] to-[#FF1469]"
            style={{ width: `${percentage}%` }}
          />
        </div>
        {/* Native range input overlay (opacity 0) */}
        <input
          type="range"
          ref={ref}
          value={value}
          min={min}
          max={max}
          onChange={(e) => onValueChange?.(Number(e.target.value))}
          className="absolute w-full h-1 opacity-0 cursor-pointer"
          {...props}
        />
        {/* Thumb visually representing the native input thumb */}
        <div
          className="absolute w-6 h-6 bg-white border-2 border-melon-pink rounded-full shadow-[0_0_12px_rgba(255,20,105,0.35)] pointer-events-none group-active:scale-[1.08] transition-transform duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ left: `calc(${percentage}% - 12px)` }}
        />
      </div>
    )
  }
)
Slider.displayName = "Slider"

export { Slider }

