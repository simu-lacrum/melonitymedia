'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
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
    <Card className="w-full max-w-md">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-pure-white" style={{ fontSize: '2rem', fontStretch: '130%' }}>
          Регистрация
        </h1>
        <p className="text-sm text-muted-gray mt-2">
          Создайте аккаунт для начала работы
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Имя"
          type="text"
          placeholder="Ваше имя"
          value={name}
          onChange={e => setName(e.target.value)}
        />

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
          placeholder="Минимум 6 символов"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={6}
        />

        {error && (
          <p className="text-sm text-alert-red text-center">{error}</p>
        )}

        <Button type="submit" loading={loading} className="w-full mt-2">
          Создать аккаунт
        </Button>
      </form>

      <p className="text-sm text-muted-gray text-center mt-6">
        Уже есть аккаунт?{' '}
        <Link href="/auth/login" className="text-melon-pink hover:underline">
          Войти
        </Link>
      </p>
    </Card>
  );
}
