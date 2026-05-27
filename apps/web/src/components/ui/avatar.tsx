import * as React from "react"
import { cn } from "@/lib/utils"
import { User } from "lucide-react"

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  alt?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = {
  sm: 'w-8 h-8', // 32px (header)
  md: 'w-10 h-10', // 40px (table row)
  lg: 'w-14 h-14', // 56px (drawer)
  xl: 'w-20 h-20', // 80px (detail page)
}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
  ({ src, alt, size = 'md', className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "relative flex shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/5",
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {src ? (
          <img
            src={src}
            alt={alt || "Avatar"}
            className="aspect-square h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/5 text-text-muted">
            <User className="h-1/2 w-1/2" />
          </div>
        )}
      </div>
    )
  }
)
Avatar.displayName = "Avatar"

export interface AvatarStackProps extends React.HTMLAttributes<HTMLDivElement> {
  avatars: { src?: string | null; alt?: string | null }[];
  max?: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const AvatarStack = React.forwardRef<HTMLDivElement, AvatarStackProps>(
  ({ avatars, max = 4, size = 'md', className, ...props }, ref) => {
    const visibleAvatars = avatars.slice(0, max)
    const excessCount = avatars.length - max

    return (
      <div ref={ref} className={cn("flex items-center -space-x-1.5", className)} {...props}>
        {visibleAvatars.map((avatar, i) => (
          <Avatar
            key={i}
            src={avatar.src}
            alt={avatar.alt}
            size={size}
            className="ring-2 ring-night-base relative"
            style={{ zIndex: visibleAvatars.length - i }}
          />
        ))}
        {excessCount > 0 && (
          <div
            className={cn(
              "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/10 text-caption ring-2 ring-night-base",
              sizeClasses[size]
            )}
            style={{ zIndex: 0 }}
          >
            +{excessCount}
          </div>
        )}
      </div>
    )
  }
)
AvatarStack.displayName = "AvatarStack"
