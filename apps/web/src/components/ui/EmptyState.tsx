import { cn } from '@/lib/utils';
import { Button } from './Button';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({ icon, title, description, actionLabel, onAction, className }: EmptyStateProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center py-16 px-4',
      className,
    )}>
      <div className="text-muted-gray/40 mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-pure-white mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-muted-gray text-center max-w-sm mb-6">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
