'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Server, Database, HardDrive, Cpu,
  Wifi, WifiOff, RefreshCw, Activity,
  Clock, MemoryStick, Zap,
} from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';

// ─────────────────────────────────────────────────────────────
// Admin Runtime — Server Health Dashboard
//
// From instructions.md §2.5: "Состояние"
// Shows: PostgreSQL, Redis, BullMQ queues, system resources
// ─────────────────────────────────────────────────────────────

interface HealthData {
  postgres: { status: 'UP' | 'DOWN'; latency: number };
  redis: { status: 'UP' | 'DOWN'; latency: number; memory: string };
  queues: Array<{
    name: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }>;
  system: {
    uptime: number;
    cpuUsage: number;
    memoryUsed: number;
    memoryTotal: number;
  };
}

const EMPTY_HEALTH: HealthData = {
  postgres: { status: 'DOWN', latency: 0 },
  redis: { status: 'DOWN', latency: 0, memory: '0mb' },
  queues: [],
  system: { uptime: 0, cpuUsage: 0, memoryUsed: 0, memoryTotal: 0 },
};

export default function RuntimePage() {
  const [health, setHealth] = useState<HealthData>(EMPTY_HEALTH);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const data = await api.get<HealthData>('/api/admin/health');
      setHealth(data);
    } catch {
      // Leave defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15_000); // Refresh every 15s
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}д ${h}ч ${m}м`;
  };

  const memoryPercent = health.system.memoryTotal > 0
    ? (health.system.memoryUsed / health.system.memoryTotal * 100).toFixed(1)
    : '0';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl text-display-wide">Состояние</h1>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchHealth}>
          Обновить
        </Button>
      </div>

      {/* Service Health */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* PostgreSQL */}
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-surface-dark">
              <Database className="w-5 h-5 text-muted-gray" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-pure-white">PostgreSQL</p>
              <Badge variant={health.postgres.status === 'UP' ? 'success' : 'error'}>
                {health.postgres.status === 'UP' ? 'Онлайн' : 'Оффлайн'}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-gray">
            Задержка: <span className="text-pure-white">{health.postgres.latency}ms</span>
          </p>
        </Card>

        {/* Redis */}
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-surface-dark">
              <Zap className="w-5 h-5 text-muted-gray" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-pure-white">Redis</p>
              <Badge variant={health.redis.status === 'UP' ? 'success' : 'error'}>
                {health.redis.status === 'UP' ? 'Онлайн' : 'Оффлайн'}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-gray">
            Память: <span className="text-pure-white">{health.redis.memory}</span>
            {' · '}Задержка: <span className="text-pure-white">{health.redis.latency}ms</span>
          </p>
        </Card>

        {/* CPU */}
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-surface-dark">
              <Cpu className="w-5 h-5 text-muted-gray" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-pure-white">CPU</p>
            </div>
          </div>
          <p className="text-2xl font-bold text-pure-white">
            {health.system.cpuUsage.toFixed(1)}%
          </p>
          {/* Progress bar */}
          <div className="mt-2 h-1.5 bg-night-base rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${health.system.cpuUsage}%`,
                background: health.system.cpuUsage > 80 ? '#f43f5e' : health.system.cpuUsage > 50 ? '#f59e0b' : '#00d287',
              }}
            />
          </div>
        </Card>

        {/* RAM */}
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-surface-dark">
              <HardDrive className="w-5 h-5 text-muted-gray" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-pure-white">RAM</p>
            </div>
          </div>
          <p className="text-2xl font-bold text-pure-white">
            {memoryPercent}%
          </p>
          <p className="text-xs text-muted-gray mt-1">
            {(health.system.memoryUsed / 1024 / 1024 / 1024).toFixed(1)} ГБ /{' '}
            {(health.system.memoryTotal / 1024 / 1024 / 1024).toFixed(1)} ГБ
          </p>
          <div className="mt-2 h-1.5 bg-night-base rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${memoryPercent}%`,
                background: parseFloat(memoryPercent) > 80 ? '#f43f5e' : '#00d287',
              }}
            />
          </div>
        </Card>
      </div>

      {/* Uptime */}
      <Card className="flex items-center gap-4">
        <Clock className="w-5 h-5 text-muted-gray" />
        <div>
          <p className="text-sm text-muted-gray">Аптайм сервера</p>
          <p className="text-lg font-semibold text-pure-white">
            {formatUptime(health.system.uptime)}
          </p>
        </div>
      </Card>

      {/* BullMQ Queues */}
      <Card>
        <CardTitle>Очереди BullMQ</CardTitle>
        <CardDescription>Состояние задач по очередям</CardDescription>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-muted-gray/10">
                <th className="p-3 text-left text-xs font-medium text-muted-gray uppercase">Очередь</th>
                <th className="p-3 text-left text-xs font-medium text-muted-gray uppercase">Ожидание</th>
                <th className="p-3 text-left text-xs font-medium text-muted-gray uppercase">Активные</th>
                <th className="p-3 text-left text-xs font-medium text-muted-gray uppercase">Завершены</th>
                <th className="p-3 text-left text-xs font-medium text-muted-gray uppercase">Ошибки</th>
              </tr>
            </thead>
            <tbody>
              {health.queues.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-gray/40">
                    Нет данных об очередях
                  </td>
                </tr>
              ) : (
                health.queues.map(q => (
                  <tr key={q.name} className="border-b border-muted-gray/5 hover:bg-surface-dark/30 transition-colors">
                    <td className="p-3 text-sm font-medium text-pure-white">{q.name}</td>
                    <td className="p-3">
                      <Badge variant={q.waiting > 0 ? 'warning' : 'neutral'}>{q.waiting}</Badge>
                    </td>
                    <td className="p-3">
                      <Badge variant={q.active > 0 ? 'info' : 'neutral'}>{q.active}</Badge>
                    </td>
                    <td className="p-3">
                      <Badge variant="success">{q.completed}</Badge>
                    </td>
                    <td className="p-3">
                      <Badge variant={q.failed > 0 ? 'error' : 'neutral'}>{q.failed}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
