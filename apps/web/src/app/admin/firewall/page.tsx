import { EmptyState } from '@/components/ui/EmptyState';
import { Shield } from 'lucide-react';

export default function FirewallPage() {
  return (
    <div>
      <h1 className="text-4xl mb-8 text-display-wide">Файрвол</h1>

      <EmptyState
        icon={<Shield className="w-16 h-16" />}
        title="Нет заблокированных IP"
        description="Добавьте IP-адреса для блокировки доступа к панели"
        actionLabel="Добавить IP"
        onAction={() => {}}
      />
    </div>
  );
}
