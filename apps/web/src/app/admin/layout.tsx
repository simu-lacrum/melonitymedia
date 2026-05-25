'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { api } from '@/lib/api';

interface UserData {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    api.get<{ user: UserData }>('/api/auth/me')
      .then(data => {
        if (data.user.role !== 'ADMIN') {
          router.push('/account/dashboard');
          return;
        }
        setUser(data.user);
      })
      .catch(() => router.push('/auth/login'));
  }, [router]);

  if (!user) {
    return (
      <div className="min-h-screen bg-night-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-melon-pink border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-night-base">
      <Header user={user} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
      <Sidebar isAdmin={true} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="lg:pl-60 pt-16">
        <div className="max-w-wrapper p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
