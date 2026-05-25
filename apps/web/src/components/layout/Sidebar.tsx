'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Briefcase, Wifi,
  Server, UserCog, Shield, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  isAdmin?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

const accountNav = [
  { href: '/account/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { href: '/account/profiles', label: 'Аккаунты', icon: Users },
  { href: '/account/workspace', label: 'Рабочая область', icon: Briefcase },
  { href: '/account/proxies', label: 'Прокси', icon: Wifi },
];

const adminNav = [
  { href: '/admin/runtime', label: 'Состояние', icon: Server },
  { href: '/admin/users', label: 'Пользователи', icon: UserCog },
  { href: '/admin/firewall', label: 'Файрвол', icon: Shield },
];

export function Sidebar({ isAdmin = false, isOpen = false, onClose }: SidebarProps) {
  const pathname = usePathname();

  const renderNavItems = (items: typeof accountNav) =>
    items.map(({ href, label, icon: Icon }) => {
      const isActive = pathname === href;
      return (
        <Link
          key={href}
          href={href}
          onClick={onClose}
          className={cn(
            'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-all duration-200',
            isActive
              ? 'text-pure-white bg-pink-alpha border-l-2 border-melon-pink font-medium'
              : 'text-muted-gray hover:text-pure-white hover:bg-surface-dark',
          )}
        >
          <Icon className="w-5 h-5 shrink-0" />
          {label}
        </Link>
      );
    });

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-full w-60 bg-night-base pt-20 pb-6 flex flex-col gap-6',
          'transition-transform duration-300 ease-out',
          // Desktop: always visible. Mobile: slide in/out.
          'lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="lg:hidden absolute top-4 right-4 text-muted-gray hover:text-pure-white"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Account Navigation */}
        <div className="px-3">
          <p className="px-4 mb-2 text-xs text-muted-gray/60 uppercase tracking-wider font-medium">
            Аккаунт
          </p>
          <nav className="flex flex-col gap-0.5">
            {renderNavItems(accountNav)}
          </nav>
        </div>

        {/* Admin Navigation */}
        {isAdmin && (
          <div className="px-3">
            <p className="px-4 mb-2 text-xs text-muted-gray/60 uppercase tracking-wider font-medium">
              Администрирование
            </p>
            <nav className="flex flex-col gap-0.5">
              {renderNavItems(adminNav)}
            </nav>
          </div>
        )}
      </aside>
    </>
  );
}
