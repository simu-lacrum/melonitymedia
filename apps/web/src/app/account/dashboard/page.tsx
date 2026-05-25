'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Eye, Users, TrendingUp, Video,
  ArrowUpRight, ArrowDownRight, Clock,
  BarChart3, Activity,
} from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Dashboard Page — Analytics Overview
//
// From instructions.md §2.1: "Дашборд"
// Displays aggregated stats: total views, followers, alive
// accounts, uploaded videos. Plus 30-day views chart.
//
// Data flows: API → /api/analytics/summary → this page
// Charts: Recharts (lazy-loaded to avoid SSR issues)
// ─────────────────────────────────────────────────────────────

interface DashboardMetrics {
  totalViews: number;
  totalFollowers: number;
  aliveAccounts: number;
  totalVideos: number;
  viewsDelta: number; // % change from previous period
  followersDelta: number;
}

interface ChartDataPoint {
  date: string;
  views: number;
  followers: number;
}

// Placeholder data for initial state
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

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [chartTab, setChartTab] = useState('views');
  const [recentJobs, setRecentJobs] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, chartRes] = await Promise.allSettled([
        api.get<{ metrics: DashboardMetrics }>('/api/analytics/summary'),
        api.get<{ data: ChartDataPoint[] }>('/api/analytics/chart?days=30'),
      ]);

      if (summaryRes.status === 'fulfilled') {
        setMetrics(summaryRes.value.metrics);
      }
      if (chartRes.status === 'fulfilled') {
        setChartData(chartRes.value.data);
      }
    } catch {
      // API not ready yet — show zeros
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Refresh every 60 seconds for near real-time dashboard
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const metricCards = [
    {
      label: 'Общие просмотры',
      value: formatNumber(metrics.totalViews),
      delta: metrics.viewsDelta,
      icon: Eye,
      color: 'text-melon-pink',
      bgColor: 'bg-melon-pink/10',
    },
    {
      label: 'Живые аккаунты',
      value: formatNumber(metrics.aliveAccounts),
      delta: null,
      icon: Users,
      color: 'text-success-green',
      bgColor: 'bg-success-green/10',
    },
    {
      label: 'Подписчики',
      value: formatNumber(metrics.totalFollowers),
      delta: metrics.followersDelta,
      icon: TrendingUp,
      color: 'text-warning-amber',
      bgColor: 'bg-warning-amber/10',
    },
    {
      label: 'Загружено видео',
      value: formatNumber(metrics.totalVideos),
      delta: null,
      icon: Video,
      color: 'text-pure-white',
      bgColor: 'bg-pure-white/10',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-4xl text-display-wide">Дашборд</h1>

      {/* ── Analytics Cards ────────────────────────────── */}
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

      {/* ── Chart Section ──────────────────────────────── */}
      <Card>
        <div className="flex items-center justify-between mb-6">
          <div>
            <CardTitle>Аналитика за 30 дней</CardTitle>
            <CardDescription>Динамика показателей</CardDescription>
          </div>
          <Tabs tabs={chartTabs} activeTab={chartTab} onTabChange={setChartTab} />
        </div>

        {chartData.length > 0 ? (
          <div className="h-72">
            {/* SVG Chart — custom lightweight chart to avoid Recharts SSR issues */}
            <ChartCanvas data={chartData} metric={chartTab as 'views' | 'followers'} />
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

      {/* ── Recent Activity ────────────────────────────── */}
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

// ── Inline SVG Chart Component ────────────────────────────
// Lightweight area chart — no external deps required.
// If Recharts causes issues with SSR, this always works.

function ChartCanvas({ data, metric }: { data: ChartDataPoint[]; metric: 'views' | 'followers' }) {
  const W = 800;
  const H = 250;
  const PAD = 40;

  const values = data.map(d => d[metric]);
  const maxVal = Math.max(...values, 1);
  const minVal = 0;

  const points = data.map((d, i) => ({
    x: PAD + (i / (data.length - 1)) * (W - PAD * 2),
    y: H - PAD - ((d[metric] - minVal) / (maxVal - minVal)) * (H - PAD * 2),
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${H - PAD} L ${points[0].x} ${H - PAD} Z`;

  const color = metric === 'views' ? '#ff1469' : '#f59e0b';
  const colorAlpha = metric === 'views' ? '#ff146920' : '#f59e0b20';

  // Y-axis labels
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
    value: Math.round(minVal + (maxVal - minVal) * pct),
    y: H - PAD - pct * (H - PAD * 2),
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {yLabels.map((l, i) => (
        <g key={i}>
          <line x1={PAD} y1={l.y} x2={W - PAD} y2={l.y} stroke="#262a30" strokeWidth="1" />
          <text x={PAD - 8} y={l.y + 4} textAnchor="end" fill="#9ca3af" fontSize="10">
            {l.value > 1000 ? `${(l.value / 1000).toFixed(0)}k` : l.value}
          </text>
        </g>
      ))}

      {/* Area fill */}
      <path d={areaPath} fill={colorAlpha} />

      {/* Line */}
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />
      ))}

      {/* X-axis labels (every 5th) */}
      {data.map((d, i) => i % 5 === 0 && (
        <text key={i} x={points[i].x} y={H - 10} textAnchor="middle" fill="#9ca3af" fontSize="10">
          {new Date(d.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
        </text>
      ))}
    </svg>
  );
}
