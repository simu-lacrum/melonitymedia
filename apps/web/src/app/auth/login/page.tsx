'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/api/auth/login', { email, password });
      router.push('/account/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Произошла ошибка при входе');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-pure-white" style={{ fontSize: '2rem', fontStretch: '130%' }}>
          Вход в систему
        </h1>
        <p className="text-sm text-muted-gray mt-2">
          MelonityMedia — панель автоматизации
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Электронная почта"
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
        />

        <Input
          label="Пароль"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />

        {error && (
          <p className="text-sm text-alert-red text-center">{error}</p>
        )}

        <Button type="submit" loading={loading} className="w-full mt-2">
          Войти
        </Button>
      </form>

      <p className="text-sm text-muted-gray text-center mt-6">
        Нет аккаунта?{' '}
        <Link href="/auth/register" className="text-melon-pink hover:underline">
          Зарегистрироваться
        </Link>
      </p>
    </Card>
  );
}
