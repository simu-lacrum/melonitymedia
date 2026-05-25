import { Card, CardTitle, CardDescription } from '@/components/ui/Card';
import { Server, Database, HardDrive, Cpu } from 'lucide-react';

export default function RuntimePage() {
  return (
    <div>
      <h1 className="text-4xl mb-8 text-display-wide">Состояние сервера</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: 'PostgreSQL', icon: Database, status: '—' },
          { label: 'Redis', icon: Server, status: '—' },
          { label: 'CPU Load', icon: Cpu, status: '—' },
          { label: 'RAM', icon: HardDrive, status: '—' },
        ].map(({ label, icon: Icon, status }) => (
          <Card key={label}>
            <div className="flex items-center gap-3">
              <Icon className="w-5 h-5 text-muted-gray" />
              <div>
                <CardDescription>{label}</CardDescription>
                <p className="text-lg font-semibold text-pure-white">{status}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
