import { cn } from '@/lib/utils';

const cardVariants = {
  default: 'strict-card',
  interactive: 'strict-card cursor-pointer',
  glass: 'bg-header-glass backdrop-blur-[20px] border border-pure-white/[0.05] rounded-xl p-6',
} as const;

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof cardVariants;
}

export function Card({ className, variant = 'default', children, ...props }: CardProps) {
  return (
    <div
      className={cn(cardVariants[variant], className, 'p-6')}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, children }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-lg font-semibold text-pure-white tracking-wide', className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm text-muted-gray mt-1.5 font-medium leading-relaxed', className)}>
      {children}
    </p>
  );
}
