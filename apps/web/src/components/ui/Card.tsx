import { cn } from '@/lib/utils';

const cardVariants = {
  default: 'bg-surface-dark',
  interactive: 'bg-surface-dark hover:brightness-110 cursor-pointer transition-all duration-200',
  glass: 'bg-header-glass backdrop-blur-[35px]',
} as const;

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: keyof typeof cardVariants;
}

export function Card({ className, variant = 'default', children, ...props }: CardProps) {
  return (
    <div
      className={cn('rounded-2xl p-6', cardVariants[variant], className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, children }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-lg font-semibold text-pure-white', className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm text-muted-gray mt-1', className)}>
      {children}
    </p>
  );
}
