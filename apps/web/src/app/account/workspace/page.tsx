'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Upload, Play, Trash2, AlertCircle,
  CheckCircle2, Clock, Search, RefreshCw,
  Rocket, Settings2, Download,
  Heart, MessageSquare, Cookie, UserPen,
  Image as ImageIcon, Hash,
} from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { Terminal } from '@/components/ui/Terminal';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { DropZone } from '@/components/ui/DropZone';
import { Drawer } from '@/components/ui/Drawer';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/lib/api';
import { connectSocket, disconnectSocket } from '@/lib/socket';
import { cn, formatDate } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Workspace Page — The Core of MelonityMedia
//
// instructions.md §3.2 ЭКРАН 3: Загрузчик и Рабочая область
//
// Блок 1: Глобальные настройки (потоки, задержка, пресет)
// Блок 2: Медиатека (Drag-n-Drop)
// Блок 3: 4 вкладки режимов работы
//   А: Залив видео (названия, описания, теги, лимиты)
//   Б: Прогрев (хештеги, ползунки вероятности, cron)
//   В: Нагул куки (доноры, время, кнопка «Скачать ZIP»)
//   Г: Профиль (аватар, баннер, био, массовое применение)
// Блок 4: Запуск + Live Terminal
// ─────────────────────────────────────────────────────────────

interface Video {
  id: string;
  title: string;
  description: string;
  filepath: string | null;
  status: 'QUEUED' | 'PROCESSING' | 'UPLOADED' | 'FAILED';
  platform: 'TIKTOK' | 'YOUTUBE';
  accountId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

const STATUS_MAP = {
  QUEUED: { label: 'В очереди', variant: 'neutral' as const, icon: Clock },
  PROCESSING: { label: 'Обработка', variant: 'info' as const, icon: Play },
  UPLOADED: { label: 'Загружено', variant: 'success' as const, icon: CheckCircle2 },
  FAILED: { label: 'Ошибка', variant: 'error' as const, icon: AlertCircle },
};

const modeTabs = [
  { id: 'upload', label: 'Залив видео' },
  { id: 'warmup', label: 'Прогрев' },
  { id: 'cookies', label: 'Нагул куки' },
  { id: 'profile', label: 'Профиль' },
];

export default function WorkspacePage() {
  const [mode, setMode] = useState('upload');
  const [videos, setVideos] = useState<Video[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [launching, setLaunching] = useState(false);

  // ── Global Settings ─────────────────────────────────────
  const [threads, setThreads] = useState(1);
  const [delayMin, setDelayMin] = useState(5);
  const [delayMax, setDelayMax] = useState(15);

  // ── Upload tab state ────────────────────────────────────
  const [titlePool, setTitlePool] = useState('');
  const [descPool, setDescPool] = useState('');
  const [tagPool, setTagPool] = useState('');
  const [dailyLimit, setDailyLimit] = useState(10);
  const [uploadDelay, setUploadDelay] = useState(60);

  // ── Warmup tab state ────────────────────────────────────
  const [warmupHashtags, setWarmupHashtags] = useState('');
  const [warmupDays, setWarmupDays] = useState(10);
  const [likeProbability, setLikeProbability] = useState(50);
  const [commentProbability, setCommentProbability] = useState(20);
  const [commentPool, setCommentPool] = useState('');
  const [viewDurationMin, setViewDurationMin] = useState(3);
  const [viewDurationMax, setViewDurationMax] = useState(15);
  const [warmupCron, setWarmupCron] = useState(false);

  // ── Cookies tab state ───────────────────────────────────
  const [donorUrls, setDonorUrls] = useState('');
  const [timePerSite, setTimePerSite] = useState(30);
  const [sitesCount, setSitesCount] = useState(5);

  // ── Profile tab state ───────────────────────────────────
  const [bio, setBio] = useState('');
  const [massApply, setMassApply] = useState(false);

  // ── Data fetching ───────────────────────────────────────
  const fetchVideos = useCallback(async () => {
    try {
      const data = await api.get<{ videos: Video[] }>('/api/videos');
      setVideos(data.videos);
    } catch { /* empty */ }
  }, []);

  useEffect(() => {
    const socket = connectSocket();
    socket.on('log', (data: LogEntry) => {
      setLogs(prev => [...prev.slice(-500), data]);
    });
    fetchVideos();
    return () => { disconnectSocket(); };
  }, [fetchVideos]);

  // ── Handlers ────────────────────────────────────────────
  const handleFileDrop = async (files: File[]) => {
    setUploading(true);
    for (const file of files) {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('title', file.name.replace(/\.[^/.]+$/, ''));

      // Include description and hashtags from the upload tab pools
      if (descPool.trim()) {
        const descriptions = descPool.split('\n').filter(Boolean);
        formData.append('description', descriptions[Math.floor(Math.random() * descriptions.length)]);
      }
      if (tagPool.trim()) {
        const tags = tagPool.split(',').map(t => t.trim()).filter(Boolean);
        tags.forEach(tag => formData.append('hashtags', tag));
      }

      try {
        await fetch('/api/videos/upload', { method: 'POST', body: formData, credentials: 'include' });
      } catch (err) { console.error('Upload failed:', err); }
    }
    setUploading(false);
    fetchVideos();
  };

  const handleBulkDelete = async () => {
    try {
      await api.delete('/api/videos/bulk', { ids: selectedIds });
      setSelectedIds([]);
      setShowDeleteModal(false);
      fetchVideos();
    } catch (err) { console.error('Bulk delete failed:', err); }
  };

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      const config = mode === 'upload' ? {
        titlePool: titlePool.split('\n').filter(Boolean),
        descPool: descPool.split('\n').filter(Boolean),
        tagPool: tagPool.split(',').map(t => t.trim()).filter(Boolean),
        dailyLimit,
        uploadDelay,
      } : mode === 'warmup' ? {
        hashtags: warmupHashtags.split(',').map(t => t.trim()).filter(Boolean),
        warmupDays,
        likeProbability,
        commentProbability,
        commentPool: commentPool.split('\n').filter(Boolean),
        viewDurationMin,
        viewDurationMax,
        cronEnabled: warmupCron,
      } : mode === 'cookies' ? {
        donorUrls: donorUrls.split('\n').filter(Boolean),
        timePerSite,
        sitesCount,
      } : {
        bio,
        massApply,
      };

      // Map frontend mode to API task type enum
      const typeMap: Record<string, string> = {
        upload: 'UPLOAD',
        warmup: 'WARMUP',
        cookies: 'COOKIES',
        profile: 'EDIT_PROFILE',
      };

      await api.post('/api/workspace/launch', {
        type: typeMap[mode],
        accountIds: selectedIds,
        applyToAll: selectedIds.length === 0,
        config,
        threads,
        delayMin,
        delayMax,
      });
      setSelectedIds([]);
    } catch (err) { console.error('Launch failed:', err); }
    setLaunching(false);
  };

  const handleDownloadCookies = async () => {
    try {
      const res = await fetch('/api/workspace/cookies/export', { credentials: 'include' });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cookies_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Cookie export failed:', err); }
  };

  const filteredVideos = videos.filter(v =>
    v.title.toLowerCase().includes(search.toLowerCase()),
  );

  const columns = [
    {
      key: 'title', label: 'Название', sortable: true,
      render: (v: Video) => (
        <span className="text-pure-white">{v.title}</span>
      ),
    },
    {
      key: 'platform', label: 'Платформа', sortable: true,
      render: (v: Video) => (
        <span className="text-muted-gray">
          {v.platform === 'TIKTOK' ? 'TikTok' : 'YouTube Shorts'}
        </span>
      ),
    },
    {
      key: 'status', label: 'Статус', sortable: true,
      render: (v: Video) => {
        const s = STATUS_MAP[v.status];
        return (
          <Badge variant={s.variant}>
            <s.icon className="w-3 h-3 mr-1" />
            {s.label}
          </Badge>
        );
      },
    },
    {
      key: 'createdAt', label: 'Дата', sortable: true,
      render: (v: Video) => (
        <span className="text-muted-gray text-xs">{formatDate(v.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Page Header ───────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-4xl text-display-wide">Рабочая область</h1>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchVideos}>
            Обновить
          </Button>
        </div>
      </div>

      {/* ── Блок 1: Глобальные настройки сессии ────────────── */}
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Settings2 className="w-4 h-4 text-melon-pink" />
          <CardTitle>Глобальные настройки сессии</CardTitle>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            label="Потоки (параллельных)"
            type="number"
            min={1}
            max={20}
            value={threads}
            onChange={e => setThreads(parseInt(e.target.value) || 1)}
          />
          <Input
            label="Задержка старта (от, сек)"
            type="number"
            min={0}
            value={delayMin}
            onChange={e => setDelayMin(parseInt(e.target.value) || 0)}
          />
          <Input
            label="Задержка старта (до, сек)"
            type="number"
            min={0}
            value={delayMax}
            onChange={e => setDelayMax(parseInt(e.target.value) || 0)}
          />
        </div>
      </Card>

      {/* ── Блок 2: Медиатека (Drag-n-Drop) ────────────────── */}
      <DropZone
        accept="video/*"
        multiple={true}
        onDrop={handleFileDrop}
        label={uploading
          ? 'Загрузка файлов...'
          : 'Перетащите видео сюда (.mp4) или нажмите для выбора'
        }
        className={cn(uploading && 'opacity-50 pointer-events-none')}
      />

      {/* Video queue + search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-gray" />
          <Input
            placeholder="Поиск по названию..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <DataTable
        data={filteredVideos}
        columns={columns}
        onSelectionChange={setSelectedIds}
        bulkActions={
          <Button variant="destructive" size="sm" icon={<Trash2 className="w-4 h-4" />} onClick={() => setShowDeleteModal(true)}>
            Удалить
          </Button>
        }
        emptyState={
          <EmptyState
            icon={<Upload className="w-16 h-16" />}
            title="Нет видео в очереди"
            description="Загрузите видео через зону выше для начала работы"
          />
        }
      />

      {/* ── Блок 3: Вкладки режимов работы ─────────────────── */}
      <Card>
        <Tabs tabs={modeTabs} activeTab={mode} onTabChange={setMode} />

        <div className="mt-6">
          {/* ── Вкладка А: Залив видео ──────────────────── */}
          {mode === 'upload' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-gray font-medium flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-melon-pink" />
                    Пул названий <span className="text-xs text-muted-gray/50">(по одному на строку, бот берёт рандомно)</span>
                  </label>
                  <textarea
                    value={titlePool}
                    onChange={e => setTitlePool(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-3 rounded-xl bg-surface-dark text-pure-white text-sm border border-transparent focus:border-melon-pink focus:outline-none focus:ring-1 focus:ring-melon-pink/30 placeholder:text-muted-gray/60 resize-none"
                    placeholder={"Мой первый TikTok\nКрутое видео #1\nСмотри до конца"}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-muted-gray font-medium">Пул описаний</label>
                  <textarea
                    value={descPool}
                    onChange={e => setDescPool(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-3 rounded-xl bg-surface-dark text-pure-white text-sm border border-transparent focus:border-melon-pink focus:outline-none focus:ring-1 focus:ring-melon-pink/30 placeholder:text-muted-gray/60 resize-none"
                    placeholder={"Подписывайся! #fyp #viral\nСмотри еще 👀"}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <Input
                  label="Пул тегов (через запятую)"
                  value={tagPool}
                  onChange={e => setTagPool(e.target.value)}
                  placeholder="fyp, viral, trending, foryou"
                />
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Лимит видео в сутки"
                    type="number"
                    min={1}
                    value={dailyLimit}
                    onChange={e => setDailyLimit(parseInt(e.target.value) || 1)}
                  />
                  <Input
                    label="Задержка между выкладками (сек)"
                    type="number"
                    min={10}
                    value={uploadDelay}
                    onChange={e => setUploadDelay(parseInt(e.target.value) || 60)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Вкладка Б: Прогрев ──────────────────────── */}
          {mode === 'warmup' && (
            <div className="flex flex-col gap-6">
              {/* Warmup duration slider */}
              <div className="flex flex-col gap-2">
                <label className="text-sm text-muted-gray font-medium flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-melon-pink" />
                  Продолжительность прогрева: <span className="text-melon-pink font-bold">{warmupDays} дней</span>
                </label>
                <input
                  type="range"
                  min={3}
                  max={21}
                  value={warmupDays}
                  onChange={e => setWarmupDays(parseInt(e.target.value))}
                  className="w-full accent-melon-pink h-2 rounded-full bg-surface-dark cursor-pointer"
                />
                <div className="flex justify-between text-xs text-muted-gray/50">
                  <span>3 дня (быстрый)</span>
                  <span>10 дней</span>
                  <span>21 день (безопасный)</span>
                </div>
                <p className="text-xs text-muted-gray/60 mt-1">
                  Фазы: пассивный просмотр → лёгкая активность → полная активность.
                  Границы масштабируются автоматически.
                </p>
              </div>
              <Input
                label="Хештеги для поиска (через запятую)"
                value={warmupHashtags}
                onChange={e => setWarmupHashtags(e.target.value)}
                placeholder="fyp, dance, comedy, viral"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Like probability slider */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-muted-gray font-medium flex items-center gap-1.5">
                    <Heart className="w-3.5 h-3.5 text-melon-pink" />
                    Вероятность лайка: <span className="text-melon-pink font-bold">{likeProbability}%</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={likeProbability}
                    onChange={e => setLikeProbability(parseInt(e.target.value))}
                    className="w-full accent-melon-pink h-2 rounded-full bg-surface-dark cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-muted-gray/50">
                    <span>0%</span><span>100%</span>
                  </div>
                </div>
                {/* Comment probability slider */}
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-muted-gray font-medium flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-ice-cyan" />
                    Вероятность комментария: <span className="text-ice-cyan font-bold">{commentProbability}%</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={commentProbability}
                    onChange={e => setCommentProbability(parseInt(e.target.value))}
                    className="w-full accent-ice-cyan h-2 rounded-full bg-surface-dark cursor-pointer"
                  />
                  <div className="flex justify-between text-xs text-muted-gray/50">
                    <span>0%</span><span>100%</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-muted-gray font-medium">Пул комментариев (по одному на строку)</label>
                <textarea
                  value={commentPool}
                  onChange={e => setCommentPool(e.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl bg-surface-dark text-pure-white text-sm border border-transparent focus:border-melon-pink focus:outline-none focus:ring-1 focus:ring-melon-pink/30 placeholder:text-muted-gray/60 resize-none"
                  placeholder={"🔥🔥🔥\nКруто!\nОбалдеть 😍\nТоп контент"}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Длительность просмотра (от, сек)"
                  type="number"
                  min={1}
                  value={viewDurationMin}
                  onChange={e => setViewDurationMin(parseInt(e.target.value) || 1)}
                />
                <Input
                  label="Длительность просмотра (до, сек)"
                  type="number"
                  min={1}
                  value={viewDurationMax}
                  onChange={e => setViewDurationMax(parseInt(e.target.value) || 1)}
                />
              </div>
              {/* Cron toggle */}
              <label className="flex items-center gap-3 p-4 rounded-xl bg-surface-dark border border-pure-white/[0.04] cursor-pointer hover:border-melon-pink/20 transition-colors">
                <input
                  type="checkbox"
                  checked={warmupCron}
                  onChange={e => setWarmupCron(e.target.checked)}
                  className="w-4 h-4 rounded accent-melon-pink"
                />
                <div>
                  <span className="text-sm font-medium text-pure-white">Прогревать ежедневно</span>
                  <p className="text-xs text-muted-gray mt-0.5">Создаёт Cron-задачу в BullMQ для автоматического прогрева каждый день</p>
                </div>
              </label>
            </div>
          )}

          {/* ── Вкладка В: Нагул куки ───────────────────── */}
          {mode === 'cookies' && (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-muted-gray font-medium flex items-center gap-1.5">
                  <Cookie className="w-3.5 h-3.5 text-warning-amber" />
                  Ссылки на сайты-доноры (по одной на строку)
                </label>
                <textarea
                  value={donorUrls}
                  onChange={e => setDonorUrls(e.target.value)}
                  rows={5}
                  className="w-full px-4 py-3 rounded-xl bg-surface-dark text-pure-white text-sm border border-transparent focus:border-melon-pink focus:outline-none focus:ring-1 focus:ring-melon-pink/30 placeholder:text-muted-gray/60 resize-none"
                  placeholder={"https://youtube.com\nhttps://google.com\nhttps://facebook.com\nhttps://instagram.com\nhttps://twitter.com"}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Время на каждом сайте (сек)"
                  type="number"
                  min={5}
                  value={timePerSite}
                  onChange={e => setTimePerSite(parseInt(e.target.value) || 30)}
                />
                <Input
                  label="Количество сайтов из списка"
                  type="number"
                  min={1}
                  value={sitesCount}
                  onChange={e => setSitesCount(parseInt(e.target.value) || 5)}
                />
              </div>
              {/* Download cookies ZIP */}
              <Button
                variant="secondary"
                icon={<Download className="w-4 h-4" />}
                onClick={handleDownloadCookies}
                className="self-start"
              >
                Скачать куки (ZIP)
              </Button>
            </div>
          )}

          {/* ── Вкладка Г: Редактирование профиля ───────── */}
          {mode === 'profile' && (
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <DropZone
                  accept="image/*"
                  multiple={false}
                  onDrop={() => {}}
                  label="Перетащите аватар"
                  className="h-32"
                />
                <DropZone
                  accept="image/*"
                  multiple={false}
                  onDrop={() => {}}
                  label="Перетащите баннер"
                  className="h-32"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-muted-gray font-medium flex items-center gap-1.5">
                  <UserPen className="w-3.5 h-3.5 text-ice-cyan" />
                  Текст био
                </label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl bg-surface-dark text-pure-white text-sm border border-transparent focus:border-melon-pink focus:outline-none focus:ring-1 focus:ring-melon-pink/30 placeholder:text-muted-gray/60 resize-none"
                  placeholder="Описание профиля..."
                />
              </div>
              <label className="flex items-center gap-3 p-4 rounded-xl bg-surface-dark border border-pure-white/[0.04] cursor-pointer hover:border-melon-pink/20 transition-colors">
                <input
                  type="checkbox"
                  checked={massApply}
                  onChange={e => setMassApply(e.target.checked)}
                  className="w-4 h-4 rounded accent-melon-pink"
                />
                <div>
                  <span className="text-sm font-medium text-pure-white">Массовое применение</span>
                  <p className="text-xs text-muted-gray mt-0.5">Установить одинаковый аватар, баннер и био на все выбранные аккаунты</p>
                </div>
              </label>
            </div>
          )}
        </div>
      </Card>

      {/* ── Блок 4: Запуск и Live Terminal ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Launch button */}
        <div className="flex flex-col gap-4">
          <button
            onClick={handleLaunch}
            disabled={launching}
            className={cn(
              'w-full py-5 rounded-2xl text-lg font-bold text-pure-white transition-all duration-300',
              'bg-gradient-to-r from-melon-pink to-ice-cyan',
              'shadow-[0_0_40px_rgba(255,20,105,0.3)]',
              'hover:shadow-[0_0_60px_rgba(255,20,105,0.5)] hover:translate-y-[-2px]',
              'active:translate-y-0 active:shadow-[0_0_20px_rgba(255,20,105,0.3)]',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0',
              'flex items-center justify-center gap-3',
            )}
          >
            <Rocket className="w-6 h-6" />
            {launching ? 'ЗАПУСК...' : 'ЗАПУСТИТЬ ЗАДАЧУ'}
          </button>
          <p className="text-xs text-muted-gray text-center">
            Режим: <span className="text-pure-white font-medium">{modeTabs.find(t => t.id === mode)?.label}</span>
            {' · '}
            Потоков: <span className="text-pure-white font-medium">{threads}</span>
            {' · '}
            Задержка: <span className="text-pure-white font-medium">{delayMin}–{delayMax}с</span>
          </p>
        </div>

        {/* Live Terminal */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <CardTitle>Live-терминал</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setLogs([])}>
              Очистить
            </Button>
          </div>
          <Terminal logs={logs} maxHeight="200px" />
        </Card>
      </div>

      {/* ── Modals ─────────────────────────────────────────── */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Удалить выбранные видео?"
        description={`Будет удалено ${selectedIds.length} видео. Это действие необратимо.`}
        confirmLabel="Удалить"
        variant="destructive"
        onConfirm={handleBulkDelete}
      />
    </div>
  );
}
