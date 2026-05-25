import { EmptyState } from '@/components/ui/EmptyState';
import { Users } from 'lucide-react';

export default function ProfilesPage() {
  return (
    <div>
      <h1 className="text-4xl mb-8 text-display-wide">База аккаунтов</h1>

      <EmptyState
        icon={<Users className="w-16 h-16" />}
        title="Нет аккаунтов"
        description="Импортируйте аккаунты TikTok или YouTube для начала работы"
        actionLabel="Импортировать"
        onAction={() => {}}
      />
    </div>
  );
}
