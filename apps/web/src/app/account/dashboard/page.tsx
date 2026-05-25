'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Eye, Users, TrendingUp, Video,
  ArrowUpRight, ArrowDownRight, Clock,
  BarChart3, Activity, Terminal
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
// Dashboard Page — Strict Corporate Minimal
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
}

const chartTabs = [
  { id: 'views', label: 'Просмотры' },
  { id: 'followers', label: 'Подписчики' },
];

const periodTabs = [
  { id: '7', label: '7 дней' },
  { id: '30', label: '30 дней' },
  { id: 'all', label: 'Всё время' },
];

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-night-base border border-pure-white/[0.1] rounded-lg px-4 py-3 shadow-2xl">
      <p className="text-xs text-muted-gray mb-2 font-mono uppercase tracking-wider">
        {new Date(label).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
      </p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-lg font-bold" style={{ color: entry.color }}>
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
      // Ignore
    }
  }, [chartPeriod]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const metricCards = [
    {
      label: 'Просмотры',
      value: formatNumber(metrics.totalViews),
      delta: metrics.viewsDelta,
      icon: Eye,
      color: 'text-pure-white',
    },
    {
      label: 'Аккаунты',
      value: formatNumber(metrics.aliveAccounts),
      delta: null,
      icon: Users,
      color: 'text-pure-white',
    },
    {
      label: 'Подписчики',
      value: formatNumber(metrics.totalFollowers),
      delta: metrics.followersDelta,
      icon: TrendingUp,
      color: 'text-pure-white',
    },
    {
      label: 'Видео',
      value: formatNumber(metrics.totalVideos),
      delta: null,
      icon: Video,
      color: 'text-pure-white',
    },
  ];

  const chartColor = chartMetric === 'views' ? '#ffffff' : '#ffffff';

  return (
    <div className="flex flex-col gap-6 max-w-[1400px] mx-auto animate-enter w-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl md:text-3xl text-display-wide text-pure-white">Обзор системы.</h1>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {metricCards.map(({ label, value, delta, icon: Icon, color }, i) => (
          <Card key={label} variant="interactive" className={`animate-enter delay-${i + 1}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-gray uppercase tracking-widest font-semibold">{label}</p>
                <p className={`text-2xl md:text-3xl font-bold mt-3 ${color}`}
                  style={{ fontStretch: '120%' }}>
                  {value}
                </p>
                {delta !== null && delta !== 0 && (
                  <div className="flex items-center gap-1 mt-2">
                    {delta > 0 ? (
                      <ArrowUpRight className="w-3.5 h-3.5 text-success-green" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 text-alert-red" />
                    )}
                    <span className={`text-xs font-semibold ${delta > 0 ? 'text-success-green' : 'text-alert-red'}`}>
                      {Math.abs(delta).toFixed(1)}%
                    </span>
                    <span className="text-xs text-muted-gray font-medium">от прошлого периода</span>
                  </div>
                )}
              </div>
              <div className="p-2 border border-pure-white/[0.1] rounded-md bg-night-base opacity-70">
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* ── Recharts Chart ─────────────────────────────────── */}
        <Card className="xl:col-span-2 animate-enter delay-3 flex flex-col min-h-[400px]">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-6">
            <div>
              <CardTitle>Метрики эффективности</CardTitle>
              <CardDescription>Динамика ключевых показателей</CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full md:w-auto">
              <Tabs tabs={chartTabs} activeTab={chartMetric} onTabChange={setChartMetric} />
              <div className="flex items-center gap-1 bg-night-base border border-pure-white/[0.05] rounded-md p-1">
                {periodTabs.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setChartPeriod(t.id)}
                    className={`px-3 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-wider transition-all ${
                      chartPeriod === t.id
                        ? 'bg-surface-elevated text-pure-white border border-pure-white/[0.1]'
                        : 'text-muted-gray hover:text-pure-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 w-full min-h-[250px] relative">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="#9ca3af"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  />
                  <YAxis
                    stroke="#9ca3af"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => v > 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="step"
                    dataKey={chartMetric}
                    stroke={chartColor}
                    strokeWidth={2}
                    fill="none"
                    activeDot={{ r: 4, fill: '#1c2026', stroke: chartColor, strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-gray/30 gap-3 border border-dashed border-pure-white/[0.05] rounded-lg">
                <BarChart3 className="w-8 h-8" />
                <p className="text-xs uppercase tracking-widest font-semibold">Ожидание данных</p>
              </div>
            )}
          </div>
        </Card>

        {/* ── Live Queue Status ──────────────────────────────── */}
        <div className="flex flex-col gap-6 animate-enter delay-4 h-full">
          <Card className="flex-1">
            <div className="flex items-center gap-2 mb-6">
              <Terminal className="w-4 h-4 text-pure-white" />
              <CardTitle>Очереди задач</CardTitle>
            </div>
            <div className="flex flex-col gap-2">
              {(queues.length > 0 ? queues : [
                { name: 'upload', active: 12, waiting: 45, completed: 890, failed: 2 },
                { name: 'warmup', active: 3, waiting: 0, completed: 120, failed: 0 },
                { name: 'cookies', active: 0, waiting: 0, completed: 54, failed: 0 },
              ]).map((q) => (
                <div
                  key={q.name}
                  className="flex items-center justify-between p-3 rounded-lg bg-night-base border border-pure-white/[0.05]"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-1.5 h-1.5 rounded-full ${q.active > 0 ? 'bg-pure-white animate-pulse' : 'bg-muted-gray/30'}`} />
                    <span className="text-xs font-semibold text-pure-white uppercase tracking-wider">{q.name}</span>
                  </div>
                  <div className="flex gap-4 text-xs font-mono">
                    {q.active > 0 && <span className="text-pure-white">A:{q.active}</span>}
                    {q.waiting > 0 && <span className="text-muted-gray">W:{q.waiting}</span>}
                    <span className="text-muted-gray/50">C:{q.completed}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="flex-1">
            <CardTitle className="mb-6">Активность</CardTitle>
            <div className="flex flex-col gap-1">
              {recentJobs.length === 0 ? (
                <div className="py-8 text-center text-muted-gray/40">
                  <p className="text-xs uppercase tracking-widest">Нет логов</p>
                </div>
              ) : (
                recentJobs.map((job, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-pure-white/[0.05] last:border-0">
                    <span className="text-xs text-pure-white flex-1 truncate">{job.description}</span>
                    <Badge variant={job.status === 'completed' ? 'success' : 'error'} className="text-[10px]">
                      {job.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
