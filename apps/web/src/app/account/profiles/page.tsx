'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Upload, Search, Trash2, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Shield,
  MoreHorizontal, Eye, Settings, Zap, Link,
} from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Profiles Page — Account Database Management
//
// From instructions.md §2.2: "База аккаунтов"
// Features:
// - Import accounts from text (login:pass:cookies or JSON)
// - DataTable with status badges (Alive/Banned/Auth Required)
// - Bulk warmup, bulk delete, bulk cookies refresh
// - Account detail drawer with live stats
// - Filter by platform, status
// ─────────────────────────────────────────────────────────────

interface Account {
  id: string;
  platform: 'TIKTOK' | 'YOUTUBE';
  login: string;
  status: 'ALIVE' | 'BANNED' | 'AUTH_REQUIRED' | 'WARMING';
  followers: number;
  views: number;
  videos: number;
  pinnedProxyId: string | null;
  warmupDay: number | null;
  warmupDays: number;
  defaultDescription: string | null;
  fingerprint: { deviceClass?: 'desktop' | 'mobile' } | any;
  createdAt: string;
  updatedAt: string;
}

const STATUS_MAP = {
  ALIVE: { label: 'Активен', variant: 'success' as const, icon: CheckCircle },
  BANNED: { label: 'Заблокирован', variant: 'error' as const, icon: XCircle },
  AUTH_REQUIRED: { label: 'Требуется авторизация', variant: 'warning' as const, icon: AlertTriangle },
  WARMING: { label: 'Прогрев', variant: 'info' as const, icon: Zap },
};

const platformTabs = [
  { id: 'all', label: 'Все' },
  { id: 'TIKTOK', label: 'TikTok' },
  { id: 'YOUTUBE', label: 'YouTube' },
];

interface AvailableProxy {
  id: string;
  name: string;
  host: string;
  port: number;
}

export default function ProfilesPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showImportDrawer, setShowImportDrawer] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDetailDrawer, setShowDetailDrawer] = useState(false);
  const [detailAccount, setDetailAccount] = useState<Account | null>(null);
  const [importText, setImportText] = useState('');
  const [importPlatform, setImportPlatform] = useState<'TIKTOK' | 'YOUTUBE'>('TIKTOK');
  const [importLoading, setImportLoading] = useState(false);
  const [showProxyModal, setShowProxyModal] = useState(false);
  const [availableProxies, setAvailableProxies] = useState<AvailableProxy[]>([]);
  const [selectedProxyId, setSelectedProxyId] = useState<string>('');
  const [proxyBindLoading, setProxyBindLoading] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await api.get<{ accounts: Account[] }>('/api/accounts');
      setAccounts(data.accounts);
    } catch {
      // Fail silently
    }
  }, []);

  const fetchProxies = useCallback(async () => {
    try {
      const data = await api.get<{ proxies: AvailableProxy[] }>('/api/proxies');
      setAvailableProxies(data.proxies);
    } catch { /* */ }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchProxies();
  }, [fetchAccounts, fetchProxies]);

  // Filter accounts
  const filtered = accounts.filter(a => {
    const matchesSearch = a.login.toLowerCase().includes(search.toLowerCase());
    const matchesPlatform = platform === 'all' || a.platform === platform;
    return matchesSearch && matchesPlatform;
  });

  // Import accounts
  const handleImport = async () => {
    setImportLoading(true);
    try {
      await api.post('/api/accounts/import', {
        platform: importPlatform,
        data: importText,
      });
      setImportText('');
      setShowImportDrawer(false);
      fetchAccounts();
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      setImportLoading(false);
    }
  };

  // Bulk warmup
  const handleBulkWarmup = async () => {
    try {
      await api.post('/api/accounts/warmup', { ids: selectedIds });
      setSelectedIds([]);
      fetchAccounts();
    } catch (err) {
      console.error('Warmup failed:', err);
    }
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    try {
      await api.delete('/api/accounts/bulk', { ids: selectedIds });
      setSelectedIds([]);
      setShowDeleteModal(false);
      fetchAccounts();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // Bulk refresh cookies
  const handleRefreshCookies = async () => {
    try {
      await api.post('/api/accounts/cookies', { ids: selectedIds });
      setSelectedIds([]);
      fetchAccounts();
    } catch (err) {
      console.error('Cookies refresh failed:', err);
    }
  };

  // Bulk proxy binding — instructions.md §3.2 ЭКРАН 2
  const openProxyBindModal = () => {
    setSelectedProxyId(availableProxies[0]?.id || '');
    setShowProxyModal(true);
  };

  const handleBulkProxyBind = async () => {
    if (!selectedProxyId) return;
    setProxyBindLoading(true);
    try {
      await api.post('/api/accounts/bulk-proxy', {
        accountIds: selectedIds,
        proxyId: selectedProxyId,
      });
      setSelectedIds([]);
      setShowProxyModal(false);
      fetchAccounts();
    } catch (err) {
      console.error('Proxy bind failed:', err);
    } finally {
      setProxyBindLoading(false);
    }
  };

  // Stat summary
  const alive = accounts.filter(a => a.status === 'ALIVE').length;
  const banned = accounts.filter(a => a.status === 'BANNED').length;
  const authRequired = accounts.filter(a => a.status === 'AUTH_REQUIRED').length;

  const columns = [
    {
      key: 'login',
      label: 'Логин',
      sortable: true,
      render: (a: Account) => (
        <button
          onClick={() => { setDetailAccount(a); setShowDetailDrawer(true); }}
          className="text-pure-white hover:text-melon-pink transition-colors text-left font-medium"
        >
          {a.login}
        </button>
      ),
    },
    {
      key: 'platform',
      label: 'Платформа',
      sortable: true,
      render: (a: Account) => (
        <span className="text-muted-gray">
          {a.platform === 'TIKTOK' ? 'TikTok' : 'YouTube'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Статус',
      sortable: true,
      render: (a: Account) => {
        const s = STATUS_MAP[a.status];
        return (
          <Badge variant={s.variant}>
            <s.icon className="w-3 h-3 mr-1" />
            {s.label}
          </Badge>
        );
      },
    },
    {
      key: 'followers',
      label: 'Подписчики',
      sortable: true,
      render: (a: Account) => (
        <span className="text-muted-gray">{a.followers.toLocaleString('ru-RU')}</span>
      ),
    },
    {
      key: 'views',
      label: 'Просмотры',
      sortable: true,
      render: (a: Account) => (
        <span className="text-muted-gray">{a.views.toLocaleString('ru-RU')}</span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Добавлен',
      sortable: true,
      render: (a: Account) => (
        <span className="text-muted-gray text-xs">{formatDate(a.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-4xl text-display-wide">База аккаунтов</h1>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={fetchAccounts}
          >
            Обновить
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Upload className="w-4 h-4" />}
            onClick={() => setShowImportDrawer(true)}
          >
            Импортировать
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="flex items-center gap-4 py-4">
          <div className="p-2 rounded-lg bg-success-green/10">
            <CheckCircle className="w-5 h-5 text-success-green" />
          </div>
          <div>
            <p className="text-2xl font-bold text-pure-white">{alive}</p>
            <p className="text-xs text-muted-gray">Активных</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 py-4">
          <div className="p-2 rounded-lg bg-alert-red/10">
            <XCircle className="w-5 h-5 text-alert-red" />
          </div>
          <div>
            <p className="text-2xl font-bold text-pure-white">{banned}</p>
            <p className="text-xs text-muted-gray">Заблокированных</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 py-4">
          <div className="p-2 rounded-lg bg-warning-amber/10">
            <AlertTriangle className="w-5 h-5 text-warning-amber" />
          </div>
          <div>
            <p className="text-2xl font-bold text-pure-white">{authRequired}</p>
            <p className="text-xs text-muted-gray">Требуют авторизации</p>
          </div>
        </Card>
      </div>

      {/* Platform Tabs + Search */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <Tabs tabs={platformTabs} activeTab={platform} onTabChange={setPlatform} />
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-gray" />
          <Input
            placeholder="Поиск по логину..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Table */}
      <DataTable
        data={filtered}
        columns={columns}
        onSelectionChange={setSelectedIds}
        bulkActions={
          <>
            <Button variant="secondary" size="sm" icon={<Link className="w-4 h-4" />} onClick={openProxyBindModal}>
              Привязать прокси
            </Button>
            <Button variant="secondary" size="sm" icon={<Zap className="w-4 h-4" />} onClick={handleBulkWarmup}>
              Прогрев
            </Button>
            <Button variant="secondary" size="sm" icon={<RefreshCw className="w-4 h-4" />} onClick={handleRefreshCookies}>
              Обновить cookies
            </Button>
            <Button variant="destructive" size="sm" icon={<Trash2 className="w-4 h-4" />} onClick={() => setShowDeleteModal(true)}>
              Удалить
            </Button>
          </>
        }
        emptyState={
          <EmptyState
            icon={<Users className="w-16 h-16" />}
            title="Нет аккаунтов"
            description="Импортируйте аккаунты TikTok или YouTube для начала работы"
            actionLabel="Импортировать"
            onAction={() => setShowImportDrawer(true)}
          />
        }
      />

      {/* Import Drawer */}
      <Drawer open={showImportDrawer} onClose={() => setShowImportDrawer(false)} title="Импорт аккаунтов">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-gray">
            Вставьте данные аккаунтов в формате <code className="text-melon-pink">login:password</code> или <code className="text-melon-pink">login:password:cookies</code>, по одному аккаунту на строку.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-gray font-medium">Платформа</label>
            <div className="flex gap-2">
              {(['TIKTOK', 'YOUTUBE'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setImportPlatform(p)}
                  className={cn(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                    importPlatform === p
                      ? 'bg-melon-pink text-pure-white'
                      : 'bg-surface-dark text-muted-gray hover:text-pure-white',
                  )}
                >
                  {p === 'TIKTOK' ? 'TikTok' : 'YouTube'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-muted-gray font-medium">Данные аккаунтов</label>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              rows={12}
              className="w-full px-4 py-3 rounded-xl bg-night-base text-pure-white text-sm font-mono border border-muted-gray/20 focus:border-melon-pink focus:outline-none focus:ring-1 focus:ring-melon-pink/30 placeholder:text-muted-gray/40 resize-none"
              placeholder="user1:password1&#10;user2:password2:cookie_data&#10;user3:password3"
            />
          </div>

          <p className="text-xs text-muted-gray">
            Обнаружено строк: <span className="text-pure-white font-medium">{importText.split('\n').filter(l => l.trim()).length}</span>
          </p>

          <Button
            variant="primary"
            onClick={handleImport}
            loading={importLoading}
            disabled={!importText.trim()}
            className="w-full"
          >
            Импортировать
          </Button>
        </div>
      </Drawer>

      {/* Account Detail Drawer */}
      <Drawer open={showDetailDrawer} onClose={() => setShowDetailDrawer(false)} title="Детали аккаунта" width="520px">
        {detailAccount && (
          <div className="flex flex-col gap-6">
            {/* Status Banner */}
            <div className={cn(
              'flex items-center gap-3 p-4 rounded-xl',
              detailAccount.status === 'ALIVE' && 'bg-success-green/5 border border-success-green/20',
              detailAccount.status === 'BANNED' && 'bg-alert-red/5 border border-alert-red/20',
              detailAccount.status === 'AUTH_REQUIRED' && 'bg-warning-amber/5 border border-warning-amber/20',
              detailAccount.status === 'WARMING' && 'bg-melon-pink/5 border border-melon-pink/20',
            )}>
              {(() => {
                const s = STATUS_MAP[detailAccount.status];
                return (
                  <>
                    <s.icon className={cn('w-5 h-5',
                      detailAccount.status === 'ALIVE' && 'text-success-green',
                      detailAccount.status === 'BANNED' && 'text-alert-red',
                      detailAccount.status === 'AUTH_REQUIRED' && 'text-warning-amber',
                      detailAccount.status === 'WARMING' && 'text-melon-pink',
                    )} />
                    <span className="text-sm font-medium text-pure-white">{s.label}</span>
                  </>
                );
              })()}
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-night-base rounded-xl p-4">
                <p className="text-xs text-muted-gray mb-1">Логин</p>
                <p className="text-sm font-medium text-pure-white">{detailAccount.login}</p>
              </div>
              <div className="bg-night-base rounded-xl p-4">
                <p className="text-xs text-muted-gray mb-1">Платформа</p>
                <p className="text-sm font-medium text-pure-white">
                  {detailAccount.platform === 'TIKTOK' ? 'TikTok' : 'YouTube'}
                </p>
              </div>
              <div className="bg-night-base rounded-xl p-4">
                <p className="text-xs text-muted-gray mb-1">Подписчики</p>
                <p className="text-lg font-bold text-pure-white">
                  {detailAccount.followers.toLocaleString('ru-RU')}
                </p>
              </div>
              <div className="bg-night-base rounded-xl p-4">
                <p className="text-xs text-muted-gray mb-1">Просмотры</p>
                <p className="text-lg font-bold text-pure-white">
                  {detailAccount.views.toLocaleString('ru-RU')}
                </p>
              </div>
              <div className="bg-night-base rounded-xl p-4">
                <p className="text-xs text-muted-gray mb-1">Видео</p>
                <p className="text-lg font-bold text-pure-white">
                  {detailAccount.videos}
                </p>
              </div>
              <div className="bg-night-base rounded-xl p-4">
                <p className="text-xs text-muted-gray mb-1">Добавлен</p>
                <p className="text-sm text-pure-white">{formatDate(detailAccount.createdAt)}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 mt-2">
              <Button variant="secondary" icon={<Zap className="w-4 h-4" />} className="w-full justify-start">
                Запустить прогрев
              </Button>
              <Button variant="secondary" icon={<RefreshCw className="w-4 h-4" />} className="w-full justify-start">
                Обновить cookies
              </Button>
              <Button variant="secondary" icon={<Eye className="w-4 h-4" />} className="w-full justify-start">
                Проверить статус
              </Button>
            </div>

            {/* Account Settings: Description + Warmup Days */}
            <div className="flex flex-col gap-4 mt-4 pt-4 border-t border-pure-white/[0.04]">
              <p className="text-sm font-medium text-pure-white flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5 text-muted-gray" />
                Настройки аккаунта
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-gray">Описание по умолчанию (для загрузки видео)</label>
                <textarea
                  defaultValue={detailAccount.defaultDescription ?? ''}
                  onBlur={async (e) => {
                    try {
                      await api.patch(`/api/accounts/${detailAccount.id}`, {
                        defaultDescription: e.target.value || null,
                      });
                    } catch { /* save failed silently */ }
                  }}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl bg-surface-dark text-pure-white text-sm border border-transparent focus:border-melon-pink focus:outline-none focus:ring-1 focus:ring-melon-pink/30 placeholder:text-muted-gray/60 resize-none"
                  placeholder="Описание, которое будет использоваться при загрузке видео..."
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-gray">
                  Продолжительность прогрева: <span className="text-melon-pink font-bold">{detailAccount.warmupDays} дней</span>
                </label>
                <input
                  type="range"
                  min={3}
                  max={21}
                  defaultValue={detailAccount.warmupDays}
                  onMouseUp={async (e) => {
                    const val = parseInt((e.target as HTMLInputElement).value);
                    try {
                      await api.patch(`/api/accounts/${detailAccount.id}`, { warmupDays: val });
                      fetchAccounts();
                    } catch { /* save failed */ }
                  }}
                  className="w-full accent-melon-pink h-2 rounded-full bg-surface-dark cursor-pointer"
                />
                <div className="flex justify-between text-xs text-muted-gray/50">
                  <span>3</span><span>10</span><span>21</span>
                </div>
              </div>
              {detailAccount.warmupDay !== null && (
                <div className="bg-night-base rounded-xl p-3">
                  <p className="text-xs text-muted-gray">
                    Текущий день прогрева: <span className="text-melon-pink font-bold">{detailAccount.warmupDay}/{detailAccount.warmupDays}</span>
                    {detailAccount.warmupDay > detailAccount.warmupDays && (
                      <Badge variant="success" className="ml-2">Завершён</Badge>
                    )}
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-1.5 mt-2">
                <label className="text-xs text-muted-gray">Тип устройства (Fingerprint)</label>
                <div className="flex gap-2">
                  {(['desktop', 'mobile'] as const).map(dc => {
                    const currentDc = detailAccount.fingerprint?.deviceClass || 'desktop';
                    const isSelected = currentDc === dc;
                    return (
                      <button
                        key={dc}
                        onClick={async () => {
                          if (isSelected) return;
                          try {
                            const res = await api.post<{deviceClass: 'desktop' | 'mobile'}>(`/api/accounts/${detailAccount.id}/regenerate-fingerprint`, {
                              deviceClass: dc,
                            });
                            // Update local state to reflect new fingerprint
                            setDetailAccount(prev => prev ? {
                              ...prev,
                              fingerprint: { ...prev.fingerprint, deviceClass: res.deviceClass }
                            } : null);
                            fetchAccounts();
                          } catch (err: any) {
                            if (err.code === 'PUBLISHED_VIDEOS_EXIST') {
                              alert('Смена типа устройства запрещена для аккаунтов с опубликованными видео (риск shadowban).');
                            } else {
                              alert('Ошибка при смене типа устройства: ' + (err.error || err.message));
                            }
                          }
                        }}
                        className={cn(
                          'flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                          isSelected
                            ? 'bg-melon-pink text-pure-white'
                            : 'bg-surface-dark text-muted-gray hover:text-pure-white border border-transparent'
                        )}
                      >
                        {dc === 'desktop' ? 'Desktop (Windows/Mac)' : 'Mobile (iOS/Android)'}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* Delete Modal */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Удалить аккаунты?"
        description={`Будет удалено ${selectedIds.length} аккаунтов. Это действие необратимо.`}
        confirmLabel="Удалить"
        variant="destructive"
        onConfirm={handleBulkDelete}
      />

      {/* Bulk Proxy Bind Modal */}
      <Modal
        open={showProxyModal}
        onClose={() => setShowProxyModal(false)}
        title="Привязать прокси к аккаунтам"
        description={`Выберите прокси для ${selectedIds.length} выбранных аккаунтов`}
        confirmLabel={proxyBindLoading ? 'Привязка...' : 'Привязать'}
        onConfirm={handleBulkProxyBind}
      >
        <div className="flex flex-col gap-3 mt-4">
          {availableProxies.length === 0 ? (
            <p className="text-sm text-muted-gray text-center py-4">
              Нет доступных прокси. Добавьте прокси на странице управления.
            </p>
          ) : (
            <>
              <label className="text-sm text-muted-gray font-medium">Прокси</label>
              <select
                value={selectedProxyId}
                onChange={e => setSelectedProxyId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-surface-dark text-pure-white text-sm border border-transparent focus:border-melon-pink focus:outline-none focus:ring-1 focus:ring-melon-pink/30 appearance-none cursor-pointer"
              >
                {availableProxies.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.host} — {p.host}:{p.port}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
