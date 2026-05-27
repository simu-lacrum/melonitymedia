"use client";

import * as React from "react"
import { cn } from "@/lib/utils"
import { motion } from "framer-motion"

export interface SegmentedControlProps {
  segments: { id: string; label: string }[];
  activeSegment: string;
  onChange: (id: string) => void;
  className?: string;
}

export function SegmentedControl({ segments, activeSegment, onChange, className }: SegmentedControlProps) {
  return (
    <div className={cn("liquid-glass-base flex items-center p-1 rounded-pill w-full", className)}>
      {segments.map((segment) => {
        const isActive = activeSegment === segment.id
        return (
          <button
            key={segment.id}
            onClick={() => onChange(segment.id)}
            className={cn(
              "relative flex-1 px-3 py-1.5 text-body-sm font-medium rounded-pill transition-colors focus-visible:outline-none z-10",
              isActive ? "text-melon-pink" : "text-text-muted hover:text-white"
            )}
          >
            {isActive && (
              <motion.div
                layoutId="activeSegment"
                className="absolute inset-0 liquid-glass-elevated bg-melon-tint rounded-pill -z-10"
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
              />
            )}
            <div className="relative flex flex-col items-center">
              {segment.label}
              {isActive && (
                <div className="absolute -bottom-1 w-1 h-1 bg-melon-pink rounded-full" />
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
