'use client';

// ─────────────────────────────────────────────────────────────
// MelonityMedia — Landing Page
//
// Aesthetic: "Corporate Neon" — luxury-minimal meets industrial
// Color story: Night base (#1c2026) dominant, melon pink accent,
// ice cyan secondary. Brand gradient used sparingly.
//
// Differentiation anchor: The angular logo floats at the
// intersection of two gradient planes — recognizable without text.
//
// DFII Score: Impact 5 + Fit 5 + Feasibility 5 + Performance 4
//             − Consistency Risk 1 = 18 (Excellent)
// ─────────────────────────────────────────────────────────────

import Link from 'next/link';
import Image from 'next/image';
import {
  Upload, Shield, BarChart3, Zap, Globe,
  ChevronRight, ArrowRight, Smartphone,
  TrendingUp, Lock, Cpu, RefreshCw,
  Activity, Layers,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-night-base overflow-hidden">
      {/* ── Navbar ─────────────────────────────────────────── */}
      <nav className="header-blur" id="landing-nav">
        <div className="max-w-wrapper flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <Image
              src="/logo.svg"
              alt="MelonityMedia"
              width={36}
              height={36}
              className="transition-transform duration-500 group-hover:rotate-12"
            />
            <span className="text-lg font-semibold tracking-tight text-pure-white">
              Melonity<span className="text-melon-pink">Media</span>
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#capabilities" className="text-muted-gray hover:text-pure-white transition-colors text-sm">
              Платформа
            </a>
            <a href="#workflow" className="text-muted-gray hover:text-pure-white transition-colors text-sm">
              Как работает
            </a>
            <a href="#infrastructure" className="text-muted-gray hover:text-pure-white transition-colors text-sm">
              Инфраструктура
            </a>
            <Link
              href="/auth/login"
              className="text-sm text-muted-gray hover:text-pure-white transition-colors"
            >
              Войти
            </Link>
            <Link
              href="/auth/register"
              className="px-5 py-2.5 rounded-xl bg-melon-pink text-pure-white text-sm font-semibold hover:brightness-110 transition-all duration-300 shadow-[0_0_20px_rgba(255,20,105,0.3)] hover:shadow-[0_0_30px_rgba(255,20,105,0.5)]"
            >
              Запросить доступ
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero Section ───────────────────────────────────── */}
      <section className="relative pt-40 pb-32 px-6" id="hero">
        {/* Background — gradient planes */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute -top-40 -right-40 w-[700px] h-[700px] rounded-full opacity-[0.12] blur-[140px]"
            style={{ background: 'radial-gradient(circle, #ff1469 0%, transparent 70%)' }}
          />
          <div
            className="absolute -bottom-60 -left-40 w-[600px] h-[600px] rounded-full opacity-[0.08] blur-[120px]"
            style={{ background: 'radial-gradient(circle, #40D3F5 0%, transparent 70%)' }}
          />
          {/* Subtle grid */}
          <div
            className="absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
              `,
              backgroundSize: '80px 80px',
            }}
          />
        </div>

        <div className="max-w-wrapper relative z-[1]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            {/* Left — Copy */}
            <div>
              {/* Status pill */}
              <div className="animate-fade-up inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-dark/80 border border-pure-white/[0.06] mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-success-green" />
                <span className="text-xs text-muted-gray tracking-wider uppercase">
                  Enterprise Platform
                </span>
              </div>

              <h1 className="animate-fade-up stagger-1 text-display-wide text-4xl md:text-6xl lg:text-[4.5rem] leading-[1.05] mb-6">
                Дистрибуция контента{' '}
                <span className="text-gradient-brand">
                  без компромиссов
                </span>
              </h1>

              <p className="animate-fade-up stagger-2 text-lg text-muted-gray max-w-lg mb-10 leading-relaxed">
                Melonity — корпоративная платформа для автоматизации публикации
                вертикального видео. Антидетект-среда, управление аккаунтами
                и аналитика —{' '}
                <span className="text-pure-white font-medium">
                  единый центр управления
                </span>.
              </p>

              {/* CTA */}
              <div className="animate-fade-up stagger-3 flex flex-wrap items-center gap-4">
                <Link
                  href="/auth/register"
                  className="group flex items-center gap-2.5 px-7 py-3.5 rounded-xl bg-melon-pink text-pure-white font-semibold hover:brightness-110 transition-all duration-300 shadow-[0_0_24px_rgba(255,20,105,0.3)] hover:shadow-[0_0_40px_rgba(255,20,105,0.5)] hover:translate-y-[-2px]"
                >
                  Запросить доступ
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
                <a
                  href="#workflow"
                  className="flex items-center gap-2 px-7 py-3.5 rounded-xl border border-pure-white/[0.08] text-muted-gray hover:text-pure-white hover:border-pure-white/20 transition-all duration-300"
                >
                  Узнать подробнее
                </a>
              </div>

              {/* Metric pills */}
              <div className="animate-fade-up stagger-4 flex flex-wrap gap-6 mt-12">
                {[
                  { value: '6', label: 'Параллельных очередей' },
                  { value: '24/7', label: 'Автоматизация' },
                  { value: '0', label: 'Фрод-детекций' },
                ].map((m, i) => (
                  <div key={i} className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-display-wide text-gradient-brand">{m.value}</span>
                    <span className="text-xs text-muted-gray">{m.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — Logo visual */}
            <div className="relative flex justify-center lg:justify-end">
              {/* Glow planes behind logo */}
              <div className="relative w-[340px] h-[340px] md:w-[420px] md:h-[420px]">
                {/* Gradient ring */}
                <div
                  className="absolute inset-8 rounded-full blur-[60px] opacity-25 animate-float-slow"
                  style={{ background: 'conic-gradient(from 135deg, #ff1469, #40D3F5, #ff1469)' }}
                />
                {/* Inner glass circle */}
                <div className="absolute inset-12 rounded-full bg-surface-dark/30 backdrop-blur-xl border border-pure-white/[0.04]" />
                {/* The logo */}
                <div className="absolute inset-0 flex items-center justify-center animate-float">
                  <Image
                    src="/logo.svg"
                    alt="Melonity"
                    width={160}
                    height={160}
                    priority
                    className="drop-shadow-[0_0_40px_rgba(255,20,105,0.3)]"
                  />
                </div>
                {/* Orbiting accents */}
                <div className="absolute top-6 right-12 w-2.5 h-2.5 rounded-full bg-ice-cyan/40 animate-float" style={{ animationDelay: '0.5s' }} />
                <div className="absolute bottom-16 left-8 w-2 h-2 rounded-full bg-melon-pink/40 animate-float-slow" style={{ animationDelay: '1s' }} />
                <div className="absolute top-1/2 right-4 w-1.5 h-1.5 rounded-full bg-pure-white/20 animate-float" style={{ animationDelay: '2s' }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Capabilities Grid ─────────────────────────────── */}
      <section className="py-28 px-6 relative" id="capabilities">
        <div className="max-w-wrapper">
          <div className="max-w-2xl mb-16">
            <p className="animate-fade-up text-xs text-melon-pink font-semibold tracking-[0.2em] uppercase mb-3">
              Платформа
            </p>
            <h2 className="animate-fade-up stagger-1 text-3xl md:text-5xl text-display-wide mb-4">
              Полный контроль над{' '}
              <span className="text-gradient-brand">каждым этапом</span>
            </h2>
            <p className="animate-fade-up stagger-2 text-muted-gray text-base leading-relaxed">
              Шесть ключевых модулей покрывают весь жизненный цикл аккаунта — от создания
              до масштабирования. Каждый работает автономно через систему очередей.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: Shield,
                title: 'Антидетект-среда',
                desc: 'Патченный UndetectedChrome с динамической генерацией proxy-расширений. Нулевой фрод-рейтинг.',
                color: '#ff1469',
              },
              {
                icon: Upload,
                title: 'Публикация контента',
                desc: 'Параллельная загрузка видео на TikTok и YouTube Shorts. Описания, хештеги, расписание — из единой очереди.',
                color: '#40D3F5',
              },
              {
                icon: Globe,
                title: 'Управление прокси',
                desc: 'Ротация IP через мобильные модемы с автоматическим перезапуском. Один аккаунт — один изолированный IP.',
                color: '#ff1469',
              },
              {
                icon: RefreshCw,
                title: 'Прогрев аккаунтов',
                desc: 'Программируемые сценарии: скроллинг, лайки, комментарии. Гибкие ползунки вероятности каждого действия.',
                color: '#40D3F5',
              },
              {
                icon: BarChart3,
                title: 'Аналитика',
                desc: 'Ночной cron-сбор метрик: подписчики, просмотры, вовлечённость. Данные парсятся через Cheerio без нагрузки на аккаунт.',
                color: '#ff1469',
              },
              {
                icon: Lock,
                title: 'Сессии и cookies',
                desc: 'Автоматический фарминг и обновление cookies для поддержания авторизованных сессий.',
                color: '#40D3F5',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className={`animate-fade-up stagger-${Math.min(i + 1, 6)} glass-card p-6 group transition-all duration-500 hover:translate-y-[-4px]`}
                style={{ transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)' }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 20px 60px ${feature.color}10, 0 0 0 1px ${feature.color}18`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110"
                  style={{ background: `${feature.color}0D` }}
                >
                  <feature.icon className="w-5 h-5" style={{ color: feature.color }} />
                </div>
                <h3 className="text-base font-bold text-pure-white mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-gray leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workflow ───────────────────────────────────────── */}
      <section className="py-28 px-6" id="workflow">
        <div className="max-w-wrapper">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="animate-fade-up text-xs text-ice-cyan font-semibold tracking-[0.2em] uppercase mb-3">
              Процесс
            </p>
            <h2 className="animate-fade-up stagger-1 text-3xl md:text-5xl text-display-wide">
              Три шага до{' '}
              <span className="text-gradient-brand">результата</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                step: '01',
                icon: Layers,
                title: 'Подготовка',
                desc: 'Импортируйте аккаунты, привяжите прокси, загрузите контент в рабочую область. Система валидирует каждый компонент.',
                color: '#ff1469',
              },
              {
                step: '02',
                icon: Cpu,
                title: 'Исполнение',
                desc: 'Worker поднимает антидетект-браузер, ротирует IP через мобильный модем и выполняет задачу. Весь процесс транслируется в Live-терминал.',
                color: '#40D3F5',
              },
              {
                step: '03',
                icon: TrendingUp,
                title: 'Масштабирование',
                desc: 'Отслеживайте результаты в дашборде. Корректируйте стратегию на основе реальных данных: охваты, подписчики, конверсия.',
                color: '#ff1469',
              },
            ].map((item, i) => (
              <div
                key={i}
                className="animate-fade-up relative glass-card p-8 group hover:translate-y-[-4px] transition-all duration-500"
                style={{ animationDelay: `${0.1 + i * 0.15}s` }}
              >
                <span
                  className="absolute -top-3 -left-1 text-5xl font-black opacity-[0.06]"
                  style={{ color: item.color, fontStretch: '150%' }}
                >
                  {item.step}
                </span>
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110"
                  style={{ background: `${item.color}0D` }}
                >
                  <item.icon className="w-6 h-6" style={{ color: item.color }} />
                </div>
                <h3 className="text-lg font-bold text-pure-white mb-3">{item.title}</h3>
                <p className="text-sm text-muted-gray leading-relaxed">{item.desc}</p>

                {i < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-4 text-muted-gray/20">
                    <ChevronRight className="w-5 h-5" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Infrastructure ─────────────────────────────────── */}
      <section className="py-28 px-6 relative" id="infrastructure">
        {/* Background accent */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ background: 'linear-gradient(180deg, transparent 0%, #ff1469 50%, transparent 100%)' }}
        />

        <div className="max-w-wrapper relative z-[1]">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            {/* Left — Architecture visual */}
            <div className="animate-fade-up">
              <div className="glass-card p-8 space-y-4">
                {/* Architecture layers */}
                {[
                  { label: 'Frontend', tech: 'Next.js 15 · React 19 · Tailwind v4', color: '#ff1469', icon: Smartphone },
                  { label: 'API', tech: 'Express.js · Prisma · Socket.io', color: '#40D3F5', icon: Activity },
                  { label: 'Queue', tech: 'BullMQ · Redis 7 · 6 Queues', color: '#ff1469', icon: Zap },
                  { label: 'Worker', tech: 'UndetectedChrome · Cheerio · Xvfb', color: '#40D3F5', icon: Cpu },
                  { label: 'Data', tech: 'PostgreSQL 16 · Prisma Migrate', color: '#ff1469', icon: Layers },
                ].map((layer, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 p-3 rounded-lg bg-night-base/50 border border-pure-white/[0.04] hover:border-pure-white/[0.08] transition-colors duration-300"
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${layer.color}0D` }}
                    >
                      <layer.icon className="w-4 h-4" style={{ color: layer.color }} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-pure-white">{layer.label}</div>
                      <div className="text-xs text-muted-gray">{layer.tech}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — Copy */}
            <div>
              <p className="animate-fade-up text-xs text-melon-pink font-semibold tracking-[0.2em] uppercase mb-3">
                Инфраструктура
              </p>
              <h2 className="animate-fade-up stagger-1 text-3xl md:text-5xl text-display-wide mb-6">
                Production-ready{' '}
                <span className="text-gradient-brand">из коробки</span>
              </h2>
              <p className="animate-fade-up stagger-2 text-muted-gray text-base leading-relaxed mb-6">
                Каждый компонент изолирован в Docker-контейнере. Worker запускается
                внутри Xvfb — антифрод-системы не обнаруживают headless-режим.
                Деплой на чистую Ubuntu VPS одной командой.
              </p>

              <div className="animate-fade-up stagger-3 space-y-3">
                {[
                  'Tenant-изоляция — каждый пользователь видит только свои данные',
                  'IP Firewall — мгновенная блокировка через Redis Middleware',
                  'JWT HttpOnly Cookies — никаких токенов в localStorage',
                  'Graceful degradation — капча не крашит сервер',
                ].map((point, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-melon-pink mt-2 shrink-0" />
                    <span className="text-sm text-muted-gray leading-relaxed">{point}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Platforms Section ──────────────────────────────── */}
      <section className="py-28 px-6" id="platforms">
        <div className="max-w-wrapper">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <p className="animate-fade-up text-xs text-ice-cyan font-semibold tracking-[0.2em] uppercase mb-3">
              Интеграции
            </p>
            <h2 className="animate-fade-up stagger-1 text-3xl md:text-5xl text-display-wide">
              Поддерживаемые{' '}
              <span className="text-gradient-brand">платформы</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            {[
              {
                name: 'TikTok',
                modules: ['Загрузка видео', 'Прогрев', 'Аналитика', 'Cookies', 'Редактирование профиля'],
                color: '#ff1469',
              },
              {
                name: 'YouTube Shorts',
                modules: ['Загрузка Shorts', 'Cookies', 'Аналитика', 'Редактирование профиля'],
                color: '#40D3F5',
              },
            ].map((platform, i) => (
              <div
                key={i}
                className="animate-fade-up glass-card p-6 group hover:translate-y-[-4px] transition-all duration-500"
                style={{ animationDelay: `${0.15 + i * 0.1}s` }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ background: `${platform.color}0D` }}
                  >
                    <Smartphone className="w-5 h-5" style={{ color: platform.color }} />
                  </div>
                  <div>
                    <h3 className="font-bold text-pure-white">{platform.name}</h3>
                    <span className="text-xs text-success-green">Полная поддержка</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {platform.modules.map((m, j) => (
                    <span
                      key={j}
                      className="text-xs text-muted-gray px-2.5 py-1 rounded-md bg-night-base/60 border border-pure-white/[0.04]"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Section ────────────────────────────────────── */}
      <section className="py-32 px-6 relative">
        <div className="max-w-wrapper relative z-[1]">
          <div
            className="glass-card p-12 md:p-16 text-center relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(255,20,105,0.05) 0%, rgba(64,211,245,0.03) 100%)',
              border: '1px solid rgba(255,20,105,0.1)',
            }}
          >
            {/* Subtle glow */}
            <div
              className="absolute -top-32 -right-32 w-[300px] h-[300px] rounded-full opacity-[0.06] blur-[80px]"
              style={{ background: '#40D3F5' }}
            />

            <div className="relative z-[1]">
              <h2 className="animate-fade-up text-3xl md:text-5xl text-display-wide mb-4">
                Готовы к{' '}
                <span className="text-gradient-brand">масштабированию?</span>
              </h2>
              <p className="animate-fade-up stagger-1 text-muted-gray text-base max-w-lg mx-auto mb-8 leading-relaxed">
                Настройте первую задачу за пять минут.
                Разверните платформу на вашей инфраструктуре или используйте наш cloud.
              </p>
              <Link
                href="/auth/register"
                className="animate-fade-up stagger-2 inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-melon-pink text-pure-white font-semibold hover:brightness-110 transition-all duration-300 shadow-[0_0_30px_rgba(255,20,105,0.35)] hover:shadow-[0_0_50px_rgba(255,20,105,0.5)] hover:translate-y-[-2px]"
              >
                Запросить доступ
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="py-10 px-6 border-t border-pure-white/[0.04]">
        <div className="max-w-wrapper">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <Image src="/logo.svg" alt="MelonityMedia" width={24} height={24} />
              <span className="text-sm text-muted-gray">
                © {new Date().getFullYear()} Melonity. Все права защищены.
              </span>
            </div>
            <div className="flex items-center gap-6">
              <a href="#capabilities" className="text-xs text-muted-gray hover:text-pure-white transition-colors">
                Платформа
              </a>
              <a href="#workflow" className="text-xs text-muted-gray hover:text-pure-white transition-colors">
                Процесс
              </a>
              <a href="#infrastructure" className="text-xs text-muted-gray hover:text-pure-white transition-colors">
                Инфраструктура
              </a>
              <Link href="/auth/login" className="text-xs text-muted-gray hover:text-melon-pink transition-colors">
                Войти
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
