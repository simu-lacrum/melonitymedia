import { EmptyState } from '@/components/ui/EmptyState';
import { UserCog } from 'lucide-react';

export default function UsersPage() {
  return (
    <div>
      <h1 className="text-4xl mb-8 text-display-wide">Пользователи</h1>

      <EmptyState
        icon={<UserCog className="w-16 h-16" />}
        title="Нет пользователей"
        description="Зарегистрированные пользователи появятся здесь"
      />
    </div>
  );
}
