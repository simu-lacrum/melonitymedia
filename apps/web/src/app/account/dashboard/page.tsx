'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Eye, Users, TrendingUp, Video,
  ArrowUpRight, ArrowDownRight, Clock,
  BarChart3, Activity,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Dashboard Page — Analytics Overview (Recharts)
//
// From instructions.md §3.2 ЭКРАН 1: Дашборд Аналитики
// - Блок 1: 4 KPI-карточки
// - Блок 2: Recharts interactive chart (7/30/all days)
// - Блок 3: Live-статус задач BullMQ
// ─────────────────────────────────────────────────────────────

interface DashboardMetrics {
  totalViews: number;
  totalFollowers: number;
  aliveAccounts: number;
  totalVideos: number;
  viewsDelta: number;
  followersDelta: number;
}

interface ChartDataPoint {
  date: string;
  views: number;
  followers: number;
}

interface QueueStatus {
  name: string;
  active: number;
  waiting: number;
  completed: number;
  failed: number;
}

const EMPTY_METRICS: DashboardMetrics = {
  totalViews: 0,
  totalFollowers: 0,
  aliveAccounts: 0,
  totalVideos: 0,
  viewsDelta: 0,
  followersDelta: 0,
};

const chartTabs = [
  { id: 'views', label: 'Просмотры' },
  { id: 'followers', label: 'Подписчики' },
];

const periodTabs = [
  { id: '7', label: '7 дней' },
  { id: '30', label: '30 дней' },
  { id: 'all', label: 'Всё время' },
];

// Custom Recharts tooltip matching dark theme
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-dark border border-pure-white/[0.08] rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-muted-gray mb-1">
        {new Date(label).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
      </p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-sm font-semibold" style={{ color: entry.color }}>
          {formatNumber(entry.value)}
        </p>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [chartMetric, setChartMetric] = useState('views');
  const [chartPeriod, setChartPeriod] = useState('30');
  const [queues, setQueues] = useState<QueueStatus[]>([]);
  const [recentJobs, setRecentJobs] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const days = chartPeriod === 'all' ? 365 : parseInt(chartPeriod);
      const [summaryRes, chartRes, queuesRes] = await Promise.allSettled([
        api.get<{ metrics: DashboardMetrics }>('/api/analytics/summary'),
        api.get<{ data: ChartDataPoint[] }>(`/api/analytics/chart?days=${days}`),
        api.get<{ queues: QueueStatus[] }>('/api/workspace/jobs'),
      ]);

      if (summaryRes.status === 'fulfilled') setMetrics(summaryRes.value.metrics);
      if (chartRes.status === 'fulfilled') setChartData(chartRes.value.data);
      if (queuesRes.status === 'fulfilled' && 'queues' in queuesRes.value) {
        setQueues(queuesRes.value.queues);
      }
    } catch {
      // API not ready — show empty state
    }
  }, [chartPeriod]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const metricCards = [
    {
      label: 'Суммарные просмотры',
      value: formatNumber(metrics.totalViews),
      delta: metrics.viewsDelta,
      icon: Eye,
      color: 'text-melon-pink',
      bgColor: 'bg-melon-pink/10',
    },
    {
      label: 'Живых аккаунтов',
      value: formatNumber(metrics.aliveAccounts),
      delta: null,
      icon: Users,
      color: 'text-success-green',
      bgColor: 'bg-success-green/10',
    },
    {
      label: 'Прирост подписчиков',
      value: formatNumber(metrics.totalFollowers),
      delta: metrics.followersDelta,
      icon: TrendingUp,
      color: 'text-ice-cyan',
      bgColor: 'bg-ice-cyan/10',
    },
    {
      label: 'Опубликовано',
      value: formatNumber(metrics.totalVideos),
      delta: null,
      icon: Video,
      color: 'text-warning-amber',
      bgColor: 'bg-warning-amber/10',
    },
  ];

  const chartColor = chartMetric === 'views' ? '#ff1469' : '#40D3F5';
  const chartColorAlpha = chartMetric === 'views' ? 'rgba(255,20,105,0.1)' : 'rgba(64,211,245,0.1)';

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-4xl text-display-wide">Дашборд</h1>

      {/* ── KPI Cards (Блок 1) ───────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {metricCards.map(({ label, value, delta, icon: Icon, color, bgColor }) => (
          <Card key={label} variant="interactive" className="group">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-gray">{label}</p>
                <p className={`text-3xl font-bold mt-2 ${color}`}
                  style={{ fontStretch: '120%', fontWeight: 700 }}>
                  {value}
                </p>
                {delta !== null && delta !== 0 && (
                  <div className="flex items-center gap-1 mt-1.5">
                    {delta > 0 ? (
                      <ArrowUpRight className="w-3.5 h-3.5 text-success-green" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 text-alert-red" />
                    )}
                    <span className={`text-xs font-medium ${delta > 0 ? 'text-success-green' : 'text-alert-red'}`}>
                      {Math.abs(delta).toFixed(1)}%
                    </span>
                    <span className="text-xs text-muted-gray/60">vs прошлый период</span>
                  </div>
                )}
              </div>
              <div className={`p-2.5 rounded-xl ${bgColor} group-hover:scale-110 transition-transform`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* ── Recharts Chart (Блок 2) ──────────────────────── */}
      <Card>
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <CardTitle>Динамика показателей</CardTitle>
            <CardDescription>Интерактивный график аналитики</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Tabs tabs={chartTabs} activeTab={chartMetric} onTabChange={setChartMetric} />
            <div className="flex items-center gap-1 bg-surface-dark rounded-lg p-1">
              {periodTabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setChartPeriod(t.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    chartPeriod === t.id
                      ? 'bg-melon-pink/20 text-melon-pink'
                      : 'text-muted-gray hover:text-pure-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {chartData.length > 0 ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#262a30" vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke="#9ca3af"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                />
                <YAxis
                  stroke="#9ca3af"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v > 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey={chartMetric}
                  stroke={chartColor}
                  strokeWidth={2}
                  fill="url(#chartGradient)"
                  dot={false}
                  activeDot={{ r: 5, fill: chartColor, stroke: '#1c2026', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-72 flex flex-col items-center justify-center text-muted-gray/30 gap-3">
            <BarChart3 className="w-16 h-16" />
            <p className="text-sm text-muted-gray/50">
              График появится после первого сбора аналитики
            </p>
          </div>
        )}
      </Card>

      {/* ── Live Queue Status (Блок 3) ───────────────────── */}
      <Card>
        <CardTitle>Live-статус задач</CardTitle>
        <CardDescription>Текущее состояние очередей BullMQ</CardDescription>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(queues.length > 0 ? queues : [
            { name: 'upload', active: 0, waiting: 0, completed: 0, failed: 0 },
            { name: 'warmup', active: 0, waiting: 0, completed: 0, failed: 0 },
            { name: 'cookies', active: 0, waiting: 0, completed: 0, failed: 0 },
            { name: 'edit-profile', active: 0, waiting: 0, completed: 0, failed: 0 },
            { name: 'analytics', active: 0, waiting: 0, completed: 0, failed: 0 },
            { name: 'cleanup', active: 0, waiting: 0, completed: 0, failed: 0 },
          ]).map((q) => (
            <div
              key={q.name}
              className="flex items-center gap-3 p-3 rounded-lg bg-night-base border border-pure-white/[0.04] hover:border-pure-white/[0.08] transition-colors"
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${q.active > 0 ? 'bg-success-green animate-pulse' : 'bg-muted-gray/30'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-pure-white capitalize">{q.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {q.active > 0 && (
                    <span className="text-xs text-success-green">{q.active} активных</span>
                  )}
                  {q.waiting > 0 && (
                    <span className="text-xs text-warning-amber">{q.waiting} в ожидании</span>
                  )}
                  {q.active === 0 && q.waiting === 0 && (
                    <span className="text-xs text-muted-gray/50">Простаивает</span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="text-xs text-muted-gray">{q.completed + q.failed}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Recent Activity ──────────────────────────────── */}
      <Card>
        <CardTitle>Последние задачи</CardTitle>
        <CardDescription>Недавно выполненные операции</CardDescription>
        <div className="mt-4 flex flex-col gap-2">
          {recentJobs.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-gray/30">
              <div className="text-center">
                <Activity className="w-10 h-10 mx-auto mb-2" />
                <p className="text-sm text-muted-gray/50">Нет недавних задач</p>
              </div>
            </div>
          ) : (
            recentJobs.map((job, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg hover:bg-night-base transition-colors">
                <Clock className="w-4 h-4 text-muted-gray shrink-0" />
                <span className="text-sm text-pure-white flex-1">{job.description}</span>
                <Badge variant={job.status === 'completed' ? 'success' : 'error'}>
                  {job.status}
                </Badge>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
