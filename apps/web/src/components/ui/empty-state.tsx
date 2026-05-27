import * as React from "react"
import { cn } from "@/lib/utils"

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center p-12 liquid-glass-surface w-full h-full min-h-[300px]",
        className
      )}
      {...props}
    >
      {icon && <div className="mb-6 text-melon-pink [&>svg]:w-24 [&>svg]:h-24 opacity-80">{icon}</div>}
      <h3 className="text-heading-md mb-2">{title}</h3>
      {description && <p className="text-body-sm text-text-muted mb-8 max-w-sm">{description}</p>}
      {action && <div>{action}</div>}
    </div>
  )
}
