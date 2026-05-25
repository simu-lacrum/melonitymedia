'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  UserCog, Shield, Ban, CheckCircle, Trash2,
  RefreshCw, Search, Settings, Crown,
} from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Drawer } from '@/components/ui/Drawer';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// Admin Users — User management page
//
// From instructions.md §2.5: Admin panel
// Manage users, adjust maxThreads, promote/demote, ban
// ─────────────────────────────────────────────────────────────

interface User {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
  maxThreads: number;
  isActive: boolean;
  createdAt: string;
  _count?: { accounts: number; videos: number };
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showEditDrawer, setShowEditDrawer] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editThreads, setEditThreads] = useState('3');

  const fetchUsers = useCallback(async () => {
    try {
      const data = await api.get<{ users: User[] }>('/api/admin/users');
      setUsers(data.users);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.name?.toLowerCase().includes(search.toLowerCase())),
  );

  const openEdit = (user: User) => {
    setEditingUser(user);
    setEditThreads(String(user.maxThreads));
    setShowEditDrawer(true);
  };

  const saveUser = async () => {
    if (!editingUser) return;
    try {
      await api.patch(`/api/admin/users/${editingUser.id}`, {
        maxThreads: parseInt(editThreads) || 3,
      });
      setShowEditDrawer(false);
      fetchUsers();
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  const toggleRole = async (user: User) => {
    try {
      await api.patch(`/api/admin/users/${user.id}`, {
        role: user.role === 'ADMIN' ? 'USER' : 'ADMIN',
      });
      fetchUsers();
    } catch (err) {
      console.error('Role change failed:', err);
    }
  };

  const toggleActive = async (user: User) => {
    try {
      await api.patch(`/api/admin/users/${user.id}`, {
        isActive: !user.isActive,
      });
      fetchUsers();
    } catch (err) {
      console.error('Status change failed:', err);
    }
  };

  const handleBulkDelete = async () => {
    try {
      await api.delete('/api/admin/users/bulk', { ids: selectedIds });
      setSelectedIds([]);
      setShowDeleteModal(false);
      fetchUsers();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  const columns = [
    {
      key: 'email',
      label: 'Email',
      sortable: true,
      render: (u: User) => (
        <button
          onClick={() => openEdit(u)}
          className="text-pure-white hover:text-melon-pink transition-colors text-left font-medium flex items-center gap-2"
        >
          {u.role === 'ADMIN' && <Crown className="w-3.5 h-3.5 text-warning-amber" />}
          {u.email}
        </button>
      ),
    },
    {
      key: 'name',
      label: 'Имя',
      render: (u: User) => (
        <span className="text-muted-gray">{u.name || '—'}</span>
      ),
    },
    {
      key: 'role',
      label: 'Роль',
      sortable: true,
      render: (u: User) => (
        <Badge variant={u.role === 'ADMIN' ? 'info' : 'neutral'}>
          {u.role === 'ADMIN' ? 'Админ' : 'Пользователь'}
        </Badge>
      ),
    },
    {
      key: 'maxThreads',
      label: 'Потоки',
      sortable: true,
      render: (u: User) => (
        <span className="text-pure-white font-medium">{u.maxThreads}</span>
      ),
    },
    {
      key: 'isActive',
      label: 'Статус',
      render: (u: User) => (
        <Badge variant={u.isActive ? 'success' : 'error'}>
          {u.isActive ? 'Активен' : 'Заблокирован'}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      label: 'Регистрация',
      sortable: true,
      render: (u: User) => (
        <span className="text-muted-gray text-xs">{formatDate(u.createdAt)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-4xl text-display-wide">Пользователи</h1>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="w-4 h-4" />} onClick={fetchUsers}>
          Обновить
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="flex items-center gap-4 py-4">
          <UserCog className="w-5 h-5 text-melon-pink" />
          <div>
            <p className="text-2xl font-bold text-pure-white">{users.length}</p>
            <p className="text-xs text-muted-gray">Всего</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 py-4">
          <Crown className="w-5 h-5 text-warning-amber" />
          <div>
            <p className="text-2xl font-bold text-pure-white">{users.filter(u => u.role === 'ADMIN').length}</p>
            <p className="text-xs text-muted-gray">Админов</p>
          </div>
        </Card>
        <Card className="flex items-center gap-4 py-4">
          <Ban className="w-5 h-5 text-alert-red" />
          <div>
            <p className="text-2xl font-bold text-pure-white">{users.filter(u => !u.isActive).length}</p>
            <p className="text-xs text-muted-gray">Заблокировано</p>
          </div>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-gray" />
        <Input placeholder="Поиск по email или имени..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      {/* Table */}
      <DataTable
        data={filtered}
        columns={columns}
        onSelectionChange={setSelectedIds}
        bulkActions={
          <Button variant="destructive" size="sm" icon={<Trash2 className="w-4 h-4" />} onClick={() => setShowDeleteModal(true)}>
            Удалить
          </Button>
        }
        emptyState={
          <EmptyState
            icon={<UserCog className="w-16 h-16" />}
            title="Нет пользователей"
            description="Зарегистрированные пользователи появятся здесь"
          />
        }
      />

      {/* Edit Drawer */}
      <Drawer open={showEditDrawer} onClose={() => setShowEditDrawer(false)} title="Настройки пользователя">
        {editingUser && (
          <div className="flex flex-col gap-4">
            <div className="bg-night-base rounded-xl p-4">
              <p className="text-xs text-muted-gray mb-1">Email</p>
              <p className="text-sm font-medium text-pure-white">{editingUser.email}</p>
            </div>

            <Input
              label="Максимум потоков (maxThreads)"
              type="number"
              min={1}
              max={50}
              value={editThreads}
              onChange={e => setEditThreads(e.target.value)}
            />

            <div className="flex flex-col gap-2 mt-2">
              <Button
                variant="secondary"
                icon={<Crown className="w-4 h-4" />}
                className="w-full justify-start"
                onClick={() => toggleRole(editingUser)}
              >
                {editingUser.role === 'ADMIN' ? 'Снять права админа' : 'Сделать админом'}
              </Button>
              <Button
                variant={editingUser.isActive ? 'destructive' : 'secondary'}
                icon={editingUser.isActive ? <Ban className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                className="w-full justify-start"
                onClick={() => toggleActive(editingUser)}
              >
                {editingUser.isActive ? 'Заблокировать' : 'Разблокировать'}
              </Button>
            </div>

            <Button variant="primary" onClick={saveUser} className="w-full mt-4">
              Сохранить
            </Button>
          </div>
        )}
      </Drawer>

      {/* Delete Modal */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Удалить пользователей?"
        description={`Будет удалено ${selectedIds.length} пользователей и все их данные.`}
        confirmLabel="Удалить"
        variant="destructive"
        onConfirm={handleBulkDelete}
      />
    </div>
  );
}
