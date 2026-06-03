import * as React from "react"
import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-[12px] bg-white/5 border border-white/10 px-4 py-3 text-body-lg text-white backdrop-blur-[20px] transition-[border-color,box-shadow] duration-200 ease-out placeholder:text-text-disabled focus-visible:outline-none focus-visible:border-melon-pink focus-visible:shadow-[0_0_0_4px_rgba(255,20,105,0.15)] disabled:cursor-not-allowed disabled:opacity-50 resize-y",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
