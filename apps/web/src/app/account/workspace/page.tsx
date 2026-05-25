'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Upload, Play, Trash2, Pause, AlertCircle,
  CheckCircle2, Clock, Search, Filter, RefreshCw,
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
// This is the "рабочая панель" — the main working area where
// users configure video uploads, manage content queue, run
// upload jobs, and see live worker logs in a terminal.
//
// Architecture:
// 1. Upload Zone — drag & drop video files to server
// 2. Content Queue — DataTable of queued videos with status
// 3. Live Terminal — Socket.io real-time worker logs
// 4. Settings Drawer — per-video upload configuration
// ─────────────────────────────────────────────────────────────

interface Video {
  id: string;
  title: string;
  description: string;
  filepath: string | null;
  status: 'QUEUED' | 'PROCESSING' | 'UPLOADED' | 'FAILED';
  platform: 'TIKTOK' | 'YOUTUBE_SHORTS';
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

const tabs = [
  { id: 'queue', label: 'Очередь контента' },
  { id: 'terminal', label: 'Терминал' },
];

export default function WorkspacePage() {
  const [activeTab, setActiveTab] = useState('queue');
  const [videos, setVideos] = useState<Video[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);

  // Fetch videos from API
  const fetchVideos = useCallback(async () => {
    try {
      const data = await api.get<{ videos: Video[] }>('/api/videos');
      setVideos(data.videos);
    } catch {
      // Silently fail — user might not have videos yet
    }
  }, []);

  // Setup Socket.io for live logs
  useEffect(() => {
    const socket = connectSocket();

    socket.on('log', (data: LogEntry) => {
      setLogs(prev => [...prev.slice(-500), data]); // Keep last 500 logs
    });

    fetchVideos();

    return () => {
      disconnectSocket();
    };
  }, [fetchVideos]);

  // Upload video files
  const handleFileDrop = async (files: File[]) => {
    setUploading(true);

    for (const file of files) {
      const formData = new FormData();
      formData.append('video', file);
      formData.append('title', file.name.replace(/\.[^/.]+$/, ''));

      try {
        await fetch('/api/videos/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }

    setUploading(false);
    fetchVideos();
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    try {
      await api.delete('/api/videos/bulk', { ids: selectedIds });
      setSelectedIds([]);
      setShowDeleteModal(false);
      fetchVideos();
    } catch (err) {
      console.error('Bulk delete failed:', err);
    }
  };

  // Start upload job for selected videos
  const handleRunUpload = async () => {
    try {
      await api.post('/api/workspace/run', { videoIds: selectedIds });
      setSelectedIds([]);
      fetchVideos();
    } catch (err) {
      console.error('Run failed:', err);
    }
  };

  // Open settings drawer for a video
  const openSettings = (video: Video) => {
    setEditingVideo(video);
    setShowSettingsDrawer(true);
  };

  // Save video settings
  const saveVideoSettings = async () => {
    if (!editingVideo) return;
    try {
      await api.patch(`/api/videos/${editingVideo.id}`, {
        title: editingVideo.title,
        description: editingVideo.description,
        platform: editingVideo.platform,
        accountId: editingVideo.accountId,
      });
      setShowSettingsDrawer(false);
      fetchVideos();
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  // Filtered videos
  const filteredVideos = videos.filter(v =>
    v.title.toLowerCase().includes(search.toLowerCase()),
  );

  // Table columns
  const columns = [
    {
      key: 'title',
      label: 'Название',
      sortable: true,
      render: (v: Video) => (
        <button
          onClick={() => openSettings(v)}
          className="text-pure-white hover:text-melon-pink transition-colors text-left"
        >
          {v.title}
        </button>
      ),
    },
    {
      key: 'platform',
      label: 'Платформа',
      sortable: true,
      render: (v: Video) => (
        <span className="text-muted-gray">
          {v.platform === 'TIKTOK' ? 'TikTok' : 'YouTube Shorts'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Статус',
      sortable: true,
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
      key: 'createdAt',
      label: 'Дата',
      sortable: true,
      render: (v: Video) => (
        <span className="text-muted-gray text-xs">{formatDate(v.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-4xl text-display-wide">Рабочая область</h1>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={fetchVideos}
          >
            Обновить
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Play className="w-4 h-4" />}
            onClick={handleRunUpload}
            disabled={selectedIds.length === 0}
          >
            Запустить залив ({selectedIds.length})
          </Button>
        </div>
      </div>

      {/* Upload Zone */}
      <DropZone
        accept="video/*"
        multiple={true}
        onDrop={handleFileDrop}
        label={uploading
          ? 'Загрузка файлов...'
          : 'Перетащите видео сюда или нажмите для выбора'
        }
        className={cn(uploading && 'opacity-50 pointer-events-none')}
      />

      {/* Tabs: Queue / Terminal */}
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Queue Tab */}
      {activeTab === 'queue' && (
        <div className="flex flex-col gap-4">
          {/* Search bar */}
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

          {/* Data Table */}
          <DataTable
            data={filteredVideos}
            columns={columns}
            onSelectionChange={setSelectedIds}
            bulkActions={
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  icon={<Trash2 className="w-4 h-4" />}
                  onClick={() => setShowDeleteModal(true)}
                >
                  Удалить
                </Button>
              </>
            }
            emptyState={
              <EmptyState
                icon={<Upload className="w-16 h-16" />}
                title="Нет видео в очереди"
                description="Загрузите видео через зону выше для начала работы"
              />
            }
          />
        </div>
      )}

      {/* Terminal Tab */}
      {activeTab === 'terminal' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <CardTitle>Живой терминал</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLogs([])}
            >
              Очистить
            </Button>
          </div>
          <Terminal logs={logs} maxHeight="500px" />
        </Card>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Удалить выбранные видео?"
        description={`Будет удалено ${selectedIds.length} видео. Это действие необратимо.`}
        confirmLabel="Удалить"
        variant="destructive"
        onConfirm={handleBulkDelete}
      />

      {/* Video Settings Drawer */}
      <Drawer
        open={showSettingsDrawer}
        onClose={() => setShowSettingsDrawer(false)}
        title="Настройки видео"
      >
        {editingVideo && (
          <div className="flex flex-col gap-4">
            <Input
              label="Название"
              value={editingVideo.title}
              onChange={e => setEditingVideo({ ...editingVideo, title: e.target.value })}
            />

            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-gray font-medium">Описание</label>
              <textarea
                value={editingVideo.description}
                onChange={e => setEditingVideo({ ...editingVideo, description: e.target.value })}
                rows={5}
                className="w-full px-4 py-3 rounded-xl bg-surface-dark text-pure-white text-sm border border-transparent focus:border-melon-pink focus:outline-none focus:ring-1 focus:ring-melon-pink/30 placeholder:text-muted-gray/60 resize-none"
                placeholder="Описание для публикации..."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-muted-gray font-medium">Платформа</label>
              <div className="flex gap-2">
                {(['TIKTOK', 'YOUTUBE_SHORTS'] as const).map(platform => (
                  <button
                    key={platform}
                    onClick={() => setEditingVideo({ ...editingVideo, platform })}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                      editingVideo.platform === platform
                        ? 'bg-melon-pink text-pure-white'
                        : 'bg-surface-dark text-muted-gray hover:text-pure-white',
                    )}
                  >
                    {platform === 'TIKTOK' ? 'TikTok' : 'YouTube Shorts'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-muted-gray/10">
              <Button variant="primary" onClick={saveVideoSettings} className="flex-1">
                Сохранить
              </Button>
              <Button variant="ghost" onClick={() => setShowSettingsDrawer(false)}>
                Отмена
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
