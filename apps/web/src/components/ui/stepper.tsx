import * as React from "react"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"

export interface StepperProps {
  steps: number;
  currentStep: number;
  className?: string;
}

export function Stepper({ steps, currentStep, className }: StepperProps) {
  return (
    <div className={cn("flex items-center", className)}>
      {Array.from({ length: steps }).map((_, i) => {
        const step = i + 1;
        const isCompleted = step < currentStep;
        const isActive = step === currentStep;

        return (
          <React.Fragment key={step}>
            <div
              className={cn(
                "flex items-center justify-center w-3 h-3 rounded-full transition-colors",
                isCompleted ? "bg-melon-pink text-white w-5 h-5" : 
                isActive ? "bg-melon-pink" : "liquid-glass-base"
              )}
            >
              {isCompleted && <Check className="w-3 h-3" strokeWidth={3} />}
            </div>
            {step < steps && (
              <div
                className={cn(
                  "h-[2px] w-8 mx-2 transition-colors",
                  isCompleted ? "bg-melon-pink" : "bg-white/10"
                )}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
