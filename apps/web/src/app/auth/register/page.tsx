'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/api/auth/register', { name, email, password });
      router.push('/account/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Произошла ошибка при регистрации');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[400px] animate-enter mx-auto flex flex-col justify-center min-h-[100dvh] py-12 px-6">
      <Link href="/" className="inline-flex items-center gap-2 text-xs text-muted-gray hover:text-pure-white transition-colors uppercase tracking-wider mb-8 font-semibold w-fit">
        <ArrowLeft className="w-3 h-3" />
        На главную
      </Link>
      
      <div className="mb-8">
        <h1 className="text-3xl text-display-wide text-pure-white mb-2">
          Регистрация.
        </h1>
        <p className="text-sm text-muted-gray font-medium">
          Запросите доступ к защищенной среде.
        </p>
      </div>

      <div className="strict-card p-6 md:p-8">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input
            label="Имя"
            type="text"
            placeholder="System Admin"
            value={name}
            onChange={e => setName(e.target.value)}
            className="bg-night-base border-pure-white/[0.1] text-pure-white focus:border-pure-white/[0.3] h-12"
          />

          <Input
            label="Электронная почта"
            type="email"
            placeholder="admin@melonity.app"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="bg-night-base border-pure-white/[0.1] text-pure-white focus:border-pure-white/[0.3] h-12"
          />

          <Input
            label="Пароль"
            type="password"
            placeholder="Минимум 6 символов"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
            className="bg-night-base border-pure-white/[0.1] text-pure-white focus:border-pure-white/[0.3] h-12"
          />

          {error && (
            <div className="p-3 rounded-md bg-alert-red/10 border border-alert-red/20 text-alert-red text-sm font-medium">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading} 
            className="btn-primary-strict w-full h-12 mt-2 disabled:opacity-50 disabled:cursor-not-allowed uppercase"
          >
            {loading ? 'СОЗДАНИЕ...' : 'СОЗДАТЬ АККАУНТ'}
          </button>
        </form>
      </div>

      <p className="text-sm text-muted-gray mt-8 font-medium">
        Уже зарегистрированы?{' '}
        <Link href="/auth/login" className="text-pure-white hover:underline decoration-pure-white/30 underline-offset-4 transition-all">
          Выполнить вход
        </Link>
      </p>
    </div>
  );
}
