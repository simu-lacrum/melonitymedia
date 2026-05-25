'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Shield, Plus, Trash2, RefreshCw, Search, Globe, Ban,
} from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Admin Firewall — IP Blacklist Management
//
// From instructions.md §2.5: Redis SET-based IP firewall
// Add/remove IPs, view current blacklist
// ─────────────────────────────────────────────────────────────

interface BlockedIP {
  id: string;
  ip: string;
  reason: string;
  createdAt: string;
}

export default function FirewallPage() {
  const [blockedIPs, setBlockedIPs] = useState<BlockedIP[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [newIP, setNewIP] = useState('');
  const [newReason, setNewReason] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  const fetchIPs = useCallback(async () => {
    try {
      const data = await api.get<{ ips: BlockedIP[] }>('/api/admin/firewall');
      setBlockedIPs(data.ips);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchIPs(); }, [fetchIPs]);

  const filtered = blockedIPs.filter(ip =>
    ip.ip.includes(search) || ip.reason.toLowerCase().includes(search.toLowerCase()),
  );

  const handleAdd = async () => {
    if (!newIP.trim()) return;
    setAddLoading(true);
    try {
      await api.post('/api/admin/firewall', { ip: newIP.trim(), reason: newReason.trim() || 'Ручная блокировка' });
      setNewIP('');
      setNewReason('');
      setShowAddModal(false);
      fetchIPs();
    } catch (err) {
      console.error('Add failed:', err);
    } finally {
      setAddLoading(false);
    }
  };

  const handleBulkRemove = async () => {
    try {
      await api.delete('/api/admin/firewall/bulk', { ids: selectedIds });
      setSelectedIds([]);
      setShowDeleteModal(false);
      fetchIPs();
    } catch (err) {
      console.error('Remove failed:', err);
    }
  };

  const columns = [
    {
      key: 'ip',
      label: 'IP-адрес',
      sortable: true,
      render: (item: BlockedIP) => (
        <span className="text-pure-white font-mono text-sm">{item.ip}</span>
      ),
    },
    {
      key: 'reason',
      label: 'Причина',
      render: (item: BlockedIP) => (
        <span className="text-muted-gray text-sm">{item.reason}</span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Дата блокировки',
      sortable: true,
      render: (item: BlockedIP) => (
        <span className="text-muted-gray text-xs">{formatDate(item.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-4xl text-display-wide">Файрвол</h1>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchIPs}>
            Обновить
          </Button>
          <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowAddModal(true)}>
            Заблокировать IP
          </Button>
        </div>
      </div>

      {/* Summary Card */}
      <Card className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-alert-red/10">
          <Ban className="w-6 h-6 text-alert-red" />
        </div>
        <div>
          <p className="text-2xl font-bold text-pure-white">{blockedIPs.length}</p>
          <p className="text-sm text-muted-gray">Заблокированных IP-адресов</p>
        </div>
      </Card>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-gray" />
        <Input placeholder="Поиск по IP или причине..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      {/* Table */}
      <DataTable
        data={filtered}
        columns={columns}
        onSelectionChange={setSelectedIds}
        bulkActions={
          <Button variant="secondary" size="sm" icon={<Trash2 className="w-4 h-4" />} onClick={() => setShowDeleteModal(true)}>
            Разблокировать
          </Button>
        }
        emptyState={
          <EmptyState
            icon={<Shield className="w-16 h-16" />}
            title="Нет заблокированных IP"
            description="Заблокированные IP-адреса появятся здесь"
            actionLabel="Заблокировать IP"
            onAction={() => setShowAddModal(true)}
          />
        }
      />

      {/* Add IP — custom overlay since Modal doesn't support children */}

      {/* We need inline form since Modal doesn't have children slot - use a custom overlay */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-surface-dark rounded-2xl p-6 w-full max-w-md mx-4 animate-[scaleIn_200ms_ease]">
            <h3 className="text-lg font-semibold text-pure-white mb-4">Заблокировать IP-адрес</h3>
            <div className="flex flex-col gap-4">
              <Input
                label="IP-адрес"
                placeholder="192.168.1.1"
                value={newIP}
                onChange={e => setNewIP(e.target.value)}
              />
              <Input
                label="Причина (опционально)"
                placeholder="Подозрительная активность"
                value={newReason}
                onChange={e => setNewReason(e.target.value)}
              />
              <div className="flex items-center gap-3 mt-2">
                <Button variant="ghost" onClick={() => setShowAddModal(false)}>Отмена</Button>
                <Button variant="primary" onClick={handleAdd} loading={addLoading} disabled={!newIP.trim()}>
                  Заблокировать
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unblock Modal */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Разблокировать IP?"
        description={`Будет разблокировано ${selectedIds.length} IP-адресов.`}
        confirmLabel="Разблокировать"
        onConfirm={handleBulkRemove}
      />
    </div>
  );
}
