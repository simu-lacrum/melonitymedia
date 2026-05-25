'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, LogOut, User } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface HeaderProps {
  user?: { name?: string | null; email: string; role: string } | null;
  onMenuToggle?: () => void;
}

export function Header({ user, onMenuToggle }: HeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);

  const handleLogout = async () => {
    await api.post('/api/auth/logout');
    window.location.href = '/auth/login';
  };

  return (
    <header className="header-blur">
      <div className="max-w-wrapper flex items-center justify-between">
        {/* Left: Logo + Mobile Menu */}
        <div className="flex items-center gap-4">
          <button
            onClick={onMenuToggle}
            className="lg:hidden text-muted-gray hover:text-pure-white transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>

          <Link href="/account/dashboard" className="flex items-center gap-2">
            <span className="text-melon-pink font-bold text-xl tracking-tight"
              style={{ fontStretch: '130%' }}>
              MelonityMedia
            </span>
          </Link>
        </div>

        {/* Right: User Menu */}
        {user && (
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-surface-dark transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-melon-pink/20 flex items-center justify-center">
                <User className="w-4 h-4 text-melon-pink" />
              </div>
              <span className="text-sm text-pure-white hidden sm:inline">
                {user.name || user.email}
              </span>
            </button>

            {/* Dropdown */}
            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowUserMenu(false)} />
                <div className="absolute right-0 top-full mt-2 w-56 bg-surface-dark rounded-xl shadow-xl border border-muted-gray/10 py-2 z-40 animate-[scaleIn_150ms_ease]">
                  <div className="px-4 py-2 border-b border-muted-gray/10">
                    <p className="text-sm text-pure-white font-medium">{user.name || 'Пользователь'}</p>
                    <p className="text-xs text-muted-gray">{user.email}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-alert-red hover:bg-alert-red/5 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Выйти
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
