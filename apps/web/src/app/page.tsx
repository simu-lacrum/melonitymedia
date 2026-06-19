'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  Upload, Shield, BarChart3, Zap, Globe,
  ArrowRight, Smartphone, TrendingUp, Lock, Cpu, Layers,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// MelonityMedia — Landing Page (Strict Edition)
// Aesthetic: Editorial Brutalism / Strict Corporate Minimal
// Focus: Crisp geometry, stark contrast, professional gravity.
// No neon glows, no bouncy animations.
// ─────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-night-base overflow-hidden flex flex-col">
      {/* ── Navbar ─────────────────────────────────────────── */}
      <nav className="header-blur">
        <div className="max-w-wrapper flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <img
              src="/logo.svg"
              alt="MelonityMedia"
              width="28"
              height="28"
            />
            <span className="text-sm font-semibold tracking-wide text-pure-white uppercase">
              Melonity<span className="text-melon-pink">Media</span>
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#capabilities" className="text-muted-gray hover:text-pure-white transition-colors duration-150 ease-out text-sm font-medium">
              Платформа
            </a>
            <a href="#workflow" className="text-muted-gray hover:text-pure-white transition-colors duration-150 ease-out text-sm font-medium">
              Процесс
            </a>
            <a href="#infrastructure" className="text-muted-gray hover:text-pure-white transition-colors duration-150 ease-out text-sm font-medium">
              Инфраструктура
            </a>
            <div className="w-[1px] h-4 bg-pure-white/[0.1]"></div>
            <Link
              href="/auth/sign-in"
              className="text-sm text-muted-gray hover:text-pure-white transition-colors duration-150 ease-out font-medium"
            >
              Войти
            </Link>
            <Link
              href="/auth/sign-up"
              className="btn-primary-strict px-5 py-2 text-sm"
            >
              Запросить доступ
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1 mt-20">
        {/* ── Hero Section ───────────────────────────────────── */}
        <section className="relative pt-24 pb-32 px-6">
          <div className="max-w-wrapper">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
              {/* Left — Copy */}
              <div className="max-w-xl">
                <div className="animate-enter inline-flex items-center gap-2 px-3 py-1 mb-8 border border-pure-white/[0.1] rounded-sm bg-surface-dark/50">
                  <span className="w-1.5 h-1.5 bg-pure-white rounded-full" />
                  <span className="text-[10px] text-pure-white tracking-[0.15em] uppercase font-semibold">
                    Enterprise Automation
                  </span>
                </div>

                <h1 className="animate-enter delay-1 text-display-wide text-[2.5rem] md:text-[4rem] leading-[1.05] mb-6 text-pure-white">
                  Дистрибуция контента без компромиссов.
                </h1>

                <p className="animate-enter delay-2 text-base md:text-lg text-muted-gray mb-10 leading-relaxed font-medium">
                  Корпоративная платформа для масштабирования вертикального видео. Изолированные browser-профили, управление задачами и точная аналитика в едином терминале.
                </p>

                {/* CTA */}
                <div className="animate-enter delay-3 flex flex-wrap items-center gap-4">
                  <Link
                    href="/auth/sign-up"
                    className="btn-primary-strict flex items-center gap-2 px-7 py-3.5 text-sm"
                  >
                    Запросить доступ
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                  <a
                    href="#capabilities"
                    className="btn-outline-strict flex items-center gap-2 px-7 py-3.5 text-sm"
                  >
                    Узнать подробнее
                  </a>
                </div>

                {/* Metric grid */}
                <div className="animate-enter delay-4 grid grid-cols-3 gap-6 mt-16 border-t border-pure-white/[0.05] pt-8">
                  {[
                    { value: '6', label: 'Очередей' },
                    { value: '24/7', label: 'Работа' },
                    { value: '100%', label: 'Контроль' },
                  ].map((m, i) => (
                    <div key={i}>
                      <div className="text-2xl font-bold text-pure-white mb-1">{m.value}</div>
                      <div className="text-xs text-muted-gray uppercase tracking-wide">{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right — Animated ASCII Art */}
              <div className="hidden lg:flex justify-end animate-enter delay-2 w-full">
                <div className="liquid-glass p-8 w-full max-w-[500px] aspect-square flex items-center justify-center relative group">
                  <div className="absolute inset-0 bg-melon-pink/[0.03] opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-out" />
                  
                  {/* ASCII Art */}
                  <pre 
                    className="font-mono text-[10px] sm:text-xs leading-[1.2] text-melon-pink opacity-90 text-center select-none animate-[pulse_3s_ease-in-out_infinite]" 
                    style={{ textShadow: "0 0 15px rgba(255,20,105,0.4)" }}
                  >
{`  __  __      _             _ _         
 |  \\/  | ___| | ___  _ __ (_) |_ _   _ 
 | |\\/| |/ _ \\ |/ _ \\| '_ \\| | __| | | |
 | |  | |  __/ | (_) | | | | | |_| |_| |
 |_|  |_|\\___|_|\\___/|_| |_|_|\\__|\\__, |
                                  |___/ `}
                  </pre>

                  {/* Corner Accents */}
                  <div className="absolute top-6 left-6 w-3 h-3 border-t-2 border-l-2 border-melon-pink/40" />
                  <div className="absolute top-6 right-6 w-3 h-3 border-t-2 border-r-2 border-melon-pink/40" />
                  <div className="absolute bottom-6 left-6 w-3 h-3 border-b-2 border-l-2 border-melon-pink/40" />
                  <div className="absolute bottom-6 right-6 w-3 h-3 border-b-2 border-r-2 border-melon-pink/40" />
                  
                  {/* Status Indicator */}
                  <div className="absolute bottom-6 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-melon-pink animate-[ping_2s_ease-in-out_infinite]" />
                    <span className="text-[10px] text-melon-pink font-mono tracking-widest uppercase opacity-80">
                      System Online
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Capabilities Grid ─────────────────────────────── */}
        <section className="py-24 px-6 border-t border-pure-white/[0.05]" id="capabilities">
          <div className="max-w-wrapper">
            <div className="max-w-2xl mb-16">
              <h2 className="text-3xl md:text-4xl text-display-wide mb-4 text-pure-white">
                Архитектура системы.
              </h2>
              <p className="text-muted-gray text-base leading-relaxed">
                Изолированные модули, работающие в синергии. 
                Строгий контроль над каждым этапом публикации.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  icon: Shield,
                  title: 'Patchright Profiles',
                  desc: 'Patchright + ghost-cursor, per-account fingerprint и изолированные Xvfb-сессии с VNC-мониторингом.',
                },
                {
                  icon: Upload,
                  title: 'Массовый залив',
                  desc: 'Мультипоточная загрузка на TikTok и YouTube Shorts с CapSolver. Уникализация видео через детерминистичный FFmpeg pipeline.',
                },
                {
                  icon: Globe,
                  title: 'Мобильные прокси',
                  desc: 'Строгая привязка аккаунта к IP (Proxy Pinning). Интеграция с фермами, валидация Carrier и ASN.',
                },
                {
                  icon: Layers,
                  title: 'Прогрев (10 дней)',
                  desc: '10-day progressive curriculum: от пассивного скроллинга (FYP) к активному взаимодействию. Детекция теневого бана.',
                },
                {
                  icon: BarChart3,
                  title: 'Аналитика',
                  desc: 'JSON API парсинг через curl-impersonate TLS. ~200ms на профиль вместо долгих браузерных сессий.',
                },
                {
                  icon: Lock,
                  title: 'Умный импорт',
                  desc: 'Поддержка Netscape/JSON cookies и login:pass. Cookie refresh (продление сессий) и шифрование AES-256-GCM.',
                },
              ].map((feature, i) => (
                <div
                  key={i}
                  className="liquid-glass p-6 stagger-enter"
                >
                  <feature.icon className="w-5 h-5 text-pure-white mb-6" />
                  <h3 className="text-sm font-semibold text-pure-white uppercase tracking-wide mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-gray leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Workflow ───────────────────────────────────────── */}
        <section className="py-24 px-6 border-t border-pure-white/[0.05]" id="workflow">
          <div className="max-w-wrapper">
            <h2 className="text-3xl md:text-4xl text-display-wide mb-12 text-pure-white">
              Рабочий процесс.
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-pure-white/[0.05] rounded-lg overflow-hidden border border-pure-white/[0.05]">
              {[
                {
                  step: '01',
                  title: 'Инициализация',
                  desc: 'Загрузка метаданных, привязка прокси и валидация аккаунтов.',
                },
                {
                  step: '02',
                  title: 'Исполнение',
                  desc: 'Поднятие headless-инстансов. Изолированная публикация через Xvfb.',
                },
                {
                  step: '03',
                  title: 'Масштабирование',
                  desc: 'Анализ конверсии. Корректировка стратегий на основе агрегированных данных.',
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="bg-night-base p-8 relative"
                >
                  <span className="text-xs font-mono text-muted-gray mb-6 block">
                    STEP {item.step}
                  </span>
                  <h3 className="text-lg font-bold text-pure-white mb-3">{item.title}</h3>
                  <p className="text-sm text-muted-gray leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Infrastructure ─────────────────────────────────── */}
        <section className="py-24 px-6 border-t border-pure-white/[0.05]" id="infrastructure">
          <div className="max-w-wrapper">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
              <div>
                <h2 className="text-3xl md:text-4xl text-display-wide mb-6 text-pure-white">
                  Инфраструктура.
                </h2>
                <p className="text-muted-gray text-base leading-relaxed mb-10 max-w-md">
                  Платформа спроектирована для высоких нагрузок. Каждый узел работает независимо, обеспечивая отказоустойчивость.
                </p>

                <div className="space-y-1">
                  {[
                    ['Tenant-изоляция', 'Абсолютное разделение данных клиентов.'],
                    ['Redis Middleware', 'Мгновенная блокировка и управление очередями.'],
                    ['HttpOnly Cookies', 'Максимальная защита авторизационных сессий.'],
                    ['Xvfb + Headless', 'Скрытное исполнение без падения серверов.'],
                  ].map(([title, desc], i) => (
                    <div key={i} className="py-4 border-b border-pure-white/[0.05] last:border-0">
                      <div className="text-sm font-semibold text-pure-white mb-1">{title}</div>
                      <div className="text-sm text-muted-gray">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stack Table */}
              <div className="liquid-glass p-0 overflow-hidden">
                <div className="bg-surface-dark px-6 py-4 border-b border-pure-white/[0.05]">
                  <span className="text-xs font-mono text-muted-gray uppercase tracking-wider">Технический стек</span>
                </div>
                <div className="divide-y divide-pure-white/[0.05]">
                  {[
                    { label: 'Frontend', tech: 'Next.js 16, React 19, Tailwind v4' },
                    { label: 'API Layer', tech: 'Express.js, Prisma, Socket.io' },
                    { label: 'Queue System', tech: 'BullMQ, Redis 7' },
                    { label: 'Worker Engine', tech: 'Patchright, FFmpeg, curl-impersonate' },
                    { label: 'Database', tech: 'PostgreSQL 16' },
                    { label: 'Security', tech: 'AES-256-GCM, HttpOnly JWT, Xvfb' },
                  ].map((layer, i) => (
                    <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between p-6 hover:bg-surface-elevated/30 transition-[background-color] duration-150 ease-out">
                      <div className="text-sm font-semibold text-pure-white mb-1 sm:mb-0">{layer.label}</div>
                      <div className="text-sm font-mono text-muted-gray">{layer.tech}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Platforms Section ──────────────────────────────── */}
        <section className="py-24 px-6 border-t border-pure-white/[0.05]" id="platforms">
          <div className="max-w-wrapper">
            <h2 className="text-3xl md:text-4xl text-display-wide mb-12 text-pure-white text-center">
              Целевые платформы.
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              {[
                {
                  name: 'TikTok',
                  modules: ['Загрузка видео', 'Прогрев', 'Аналитика', 'Сессии', 'Профиль'],
                },
                {
                  name: 'YouTube Shorts',
                  modules: ['Загрузка Shorts', 'Сессии', 'Аналитика', 'Профиль'],
                },
              ].map((platform, i) => (
                <div
                  key={i}
                  className="liquid-glass p-8"
                >
                  <div className="flex items-center gap-4 mb-6">
                    <Smartphone className="w-6 h-6 text-pure-white" />
                    <div>
                      <h3 className="font-bold text-pure-white">{platform.name}</h3>
                      <span className="text-xs text-success-green uppercase tracking-wider font-semibold">Supported</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {platform.modules.map((m, j) => (
                      <span
                        key={j}
                        className="text-xs text-muted-gray px-3 py-1.5 rounded-sm border border-pure-white/[0.1] bg-night-base font-medium"
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
        <section className="py-32 px-6 border-t border-pure-white/[0.05]">
          <div className="max-w-wrapper">
            <div className="liquid-glass p-12 md:p-16 text-center max-w-3xl mx-auto">
              <h2 className="text-3xl md:text-4xl text-display-wide mb-4 text-pure-white">
                Приступить к работе.
              </h2>
              <p className="text-muted-gray text-base mx-auto mb-10 max-w-lg">
                Интеграция занимает минуты. Начните масштабирование контента уже сегодня.
              </p>
              <Link
                href="/auth/sign-up"
                className="btn-primary-strict inline-flex items-center gap-2 px-8 py-4"
              >
                Создать аккаунт
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="py-8 px-6 border-t border-pure-white/[0.05] bg-surface-dark mt-auto">
        <div className="max-w-wrapper">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="MelonityMedia" width="20" height="20" className="opacity-50" />
              <span className="text-xs text-muted-gray font-mono">
                © {new Date().getFullYear()} Melonity. STRICT SYSTEM.
              </span>
            </div>
            <div className="flex items-center gap-6">
              <Link href="/auth/sign-in" className="text-xs font-semibold text-muted-gray hover:text-pure-white transition-colors duration-150 ease-out uppercase tracking-widest">
                System Login
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

