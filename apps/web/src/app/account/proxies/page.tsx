'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wifi, Plus, Trash2, RefreshCw, Search, Signal, SignalZero,
  Check, X, Pencil, Globe, Zap, Timer,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Proxies Page — Mobile Modem Proxy Management
//
// From instructions.md §2.5:
// - User adds mobile modems (host:port:user:pass + rotation link)
// - Worker uses these proxies for browser automation
// - Each proxy can be tested for connectivity
// ─────────────────────────────────────────────────────────────

interface Proxy {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  rotationLink?: string;
  isActive: boolean;
  lastCheckedAt?: string;
  lastIP?: string;
  createdAt: string;
}

interface ProxyFormData {
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
  rotationLink: string;
}

const EMPTY_FORM: ProxyFormData = {
  name: '', host: '', port: '', username: '', password: '', rotationLink: '',
};

export default function ProxiesPage() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProxy, setEditingProxy] = useState<Proxy | null>(null);
  const [form, setForm] = useState<ProxyFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState(false);

  const fetchProxies = useCallback(async () => {
    try {
      const data = await api.get<{ proxies: Proxy[] }>('/api/proxies');
      setProxies(data.proxies);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchProxies(); }, [fetchProxies]);

  const filtered = proxies.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.host.includes(search),
  );

  // ── CRUD Operations ───────────────────────────────────────

  const openAddDrawer = () => {
    setEditingProxy(null);
    setForm(EMPTY_FORM);
    setDrawerOpen(true);
  };

  const openEditDrawer = (proxy: Proxy) => {
    setEditingProxy(proxy);
    setForm({
      name: proxy.name,
      host: proxy.host,
      port: String(proxy.port),
      username: proxy.username,
      password: proxy.password,
      rotationLink: proxy.rotationLink || '',
    });
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    if (!form.host || !form.port) return;
    setSaving(true);
    try {
      const body = {
        ...form,
        port: parseInt(form.port, 10),
      };

      if (editingProxy) {
        await api.patch(`/api/proxies/${editingProxy.id}`, body);
      } else {
        await api.post('/api/proxies', body);
      }
      setDrawerOpen(false);
      fetchProxies();
    } catch (err) {
      console.error('Save proxy error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleBulkDelete = async () => {
    try {
      await api.delete('/api/proxies/bulk', { ids: selectedIds });
      setSelectedIds([]);
      setDeleteModal(false);
      fetchProxies();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleTestProxy = async (proxyId: string) => {
    setTesting(proxyId);
    try {
      await api.post(`/api/proxies/${proxyId}/test`);
      fetchProxies();
    } catch (err) {
      console.error('Test error:', err);
    } finally {
      setTesting(null);
    }
  };

  const handleToggleActive = async (proxy: Proxy) => {
    try {
      await api.patch(`/api/proxies/${proxy.id}`, { isActive: !proxy.isActive });
      fetchProxies();
    } catch { /* */ }
  };

  // ── Summary Stats ─────────────────────────────────────────

  const totalActive = proxies.filter(p => p.isActive).length;
  const totalInactive = proxies.length - totalActive;

  // ── Table Columns ─────────────────────────────────────────

  const columns = [
    {
      key: 'name',
      label: 'Прокси',
      sortable: true,
      render: (item: Proxy) => (
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${item.isActive ? 'bg-status-active' : 'bg-muted-gray/30'}`} />
          <div>
            <p className="text-pure-white font-medium text-sm">{item.name || item.host}</p>
            <p className="text-xs text-muted-gray font-mono">
              {item.host}:{item.port}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'auth',
      label: 'Авторизация',
      render: (item: Proxy) => (
        <span className="text-muted-gray text-sm font-mono">
          {item.username ? `${item.username}:***` : '—'}
        </span>
      ),
    },
    {
      key: 'rotation',
      label: 'Ротация',
      render: (item: Proxy) => (
        item.rotationLink
          ? <Badge variant="info">Мобильный</Badge>
          : <Badge variant="neutral">Статический</Badge>
      ),
    },
    {
      key: 'lastIP',
      label: 'Последний IP',
      render: (item: Proxy) => (
        <span className="text-muted-gray text-xs font-mono">
          {item.lastIP || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Статус',
      render: (item: Proxy) => (
        <Badge variant={item.isActive ? 'success' : 'neutral'}>
          {item.isActive ? 'Активен' : 'Выключен'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (item: Proxy) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); handleTestProxy(item.id); }}
            className="p-1.5 text-muted-gray hover:text-melon-pink transition-colors"
            title="Проверить"
            disabled={testing === item.id}
          >
            {testing === item.id
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Zap className="w-4 h-4" />
            }
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleToggleActive(item); }}
            className="p-1.5 text-muted-gray hover:text-status-active transition-colors"
            title={item.isActive ? 'Выключить' : 'Включить'}
          >
            {item.isActive
              ? <Signal className="w-4 h-4" />
              : <SignalZero className="w-4 h-4" />
            }
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); openEditDrawer(item); }}
            className="p-1.5 text-muted-gray hover:text-pure-white transition-colors"
            title="Редактировать"
          >
            <Pencil className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-4xl text-display-wide">Прокси</h1>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchProxies}>
            Обновить
          </Button>
          <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={openAddDrawer}>
            Добавить прокси
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-melon-pink/10">
            <Globe className="w-6 h-6 text-melon-pink" />
          </div>
          <div>
            <p className="text-2xl font-bold text-pure-white">{proxies.length}</p>
            <p className="text-sm text-muted-gray">Всего прокси</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-status-active/10">
            <Signal className="w-6 h-6 text-status-active" />
          </div>
          <div>
            <p className="text-2xl font-bold text-pure-white">{totalActive}</p>
            <p className="text-sm text-muted-gray">Активных</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-muted-gray/10">
            <SignalZero className="w-6 h-6 text-muted-gray" />
          </div>
          <div>
            <p className="text-2xl font-bold text-pure-white">{totalInactive}</p>
            <p className="text-sm text-muted-gray">Выключенных</p>
          </div>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-gray" />
        <Input
          placeholder="Поиск по имени или хосту..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Table */}
      <DataTable
        data={filtered}
        columns={columns}
        onSelectionChange={setSelectedIds}
        bulkActions={
          <Button variant="secondary" size="sm" icon={<Trash2 className="w-4 h-4" />} onClick={() => setDeleteModal(true)}>
            Удалить
          </Button>
        }
        emptyState={
          <EmptyState
            icon={<Wifi className="w-16 h-16" />}
            title="Нет прокси"
            description="Добавьте мобильные модемы для ротации IP при загрузке видео"
            actionLabel="Добавить прокси"
            onAction={openAddDrawer}
          />
        }
      />

      {/* Add/Edit Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingProxy ? 'Редактировать прокси' : 'Добавить прокси'}
        width="440px"
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Название"
            placeholder="Модем #1 / МТС Москва"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Input
                label="Хост"
                placeholder="proxy.example.com"
                value={form.host}
                onChange={e => setForm({ ...form, host: e.target.value })}
              />
            </div>
            <Input
              label="Порт"
              placeholder="8080"
              value={form.port}
              onChange={e => setForm({ ...form, port: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Логин"
              placeholder="user"
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
            />
            <Input
              label="Пароль"
              placeholder="••••••"
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <Input
            label="Ссылка ротации IP (опционально)"
            placeholder="https://proxys.io/api/rotate?key=..."
            value={form.rotationLink}
            onChange={e => setForm({ ...form, rotationLink: e.target.value })}
          />
          <p className="text-xs text-muted-gray">
            Для мобильных модемов: ссылка, при GET-запросе на которую модем
            перезагружается и получает новый IP. Обычно предоставляется
            провайдером (proxys.io и подобные).
          </p>

          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-muted-gray/10">
            <Button variant="ghost" onClick={() => setDrawerOpen(false)}>Отмена</Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              disabled={!form.host || !form.port}
            >
              {editingProxy ? 'Сохранить' : 'Добавить'}
            </Button>
          </div>
        </div>
      </Drawer>

      {/* Delete Modal */}
      <Modal
        open={deleteModal}
        onClose={() => setDeleteModal(false)}
        title="Удалить прокси?"
        description={`Будет удалено ${selectedIds.length} прокси. Это действие необратимо.`}
        confirmLabel="Удалить"
        onConfirm={handleBulkDelete}
        variant="destructive"
      />
    </div>
  );
}
