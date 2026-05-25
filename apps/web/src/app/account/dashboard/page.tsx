import { Card, CardTitle, CardDescription } from '@/components/ui/Card';
import { Eye, Users, TrendingUp, Video } from 'lucide-react';

export default function DashboardPage() {
  // Placeholder metrics — will be populated from /api/analytics/summary
  const metrics = [
    { label: 'Общие просмотры', value: '—', icon: Eye, color: 'text-melon-pink' },
    { label: 'Живые аккаунты', value: '—', icon: Users, color: 'text-success-green' },
    { label: 'Подписчики', value: '—', icon: TrendingUp, color: 'text-warning-amber' },
    { label: 'Загружено видео', value: '—', icon: Video, color: 'text-pure-white' },
  ];

  return (
    <div>
      <h1 className="text-4xl mb-8 text-display-wide">Дашборд</h1>

      {/* Analytics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {metrics.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} variant="interactive">
            <div className="flex items-start justify-between">
              <div>
                <CardDescription>{label}</CardDescription>
                <p className={`text-3xl font-bold mt-2 text-display-wide ${color}`}
                   style={{ fontSize: '2rem' }}>
                  {value}
                </p>
              </div>
              <div className={`p-2 rounded-lg bg-surface-dark ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Charts placeholder */}
      <Card>
        <CardTitle>Просмотры за 30 дней</CardTitle>
        <CardDescription>График появится после первого сбора аналитики</CardDescription>
        <div className="h-64 flex items-center justify-center text-muted-gray/30 mt-4">
          <TrendingUp className="w-16 h-16" />
        </div>
      </Card>
    </div>
  );
}
