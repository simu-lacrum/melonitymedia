'use client';

// ─────────────────────────────────────────────────────────────
// MelonityMedia — Landing Page
//
// Design philosophy: "Neon Gravitas"
// A premium, dark-mode landing with the dual-tone brand gradient
// (melon pink #FF1469 ↔ ice cyan #40D3F5). Floating elements,
// glassmorphism cards, and bold Roboto Flex stretched headings
// create an elite automation-tool aesthetic.
//
// From design.md: Roboto Flex 150% stretch for H1, night-base
// background, melon-pink CTAs with outer glow.
// From antigravity-design-expert: weightless floating cards,
// staggered entrances, parallax depth, spatial layering.
// ─────────────────────────────────────────────────────────────

import Link from 'next/link';
import Image from 'next/image';
import {
  Upload, Shield, BarChart3, Zap, Globe, Clock,
  ChevronRight, ArrowRight, Play, Smartphone,
  TrendingUp, Lock, Cpu, RefreshCw,
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
              width={40}
              height={40}
              className="animate-glow-pulse"
            />
            <span className="text-xl font-bold tracking-tight text-pure-white group-hover:text-melon-pink transition-colors duration-300">
              Melonity<span className="text-melon-pink">Media</span>
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-muted-gray hover:text-pure-white transition-colors text-sm">
              Возможности
            </a>
            <a href="#platforms" className="text-muted-gray hover:text-pure-white transition-colors text-sm">
              Платформы
            </a>
            <a href="#stats" className="text-muted-gray hover:text-pure-white transition-colors text-sm">
              Статистика
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
              Начать бесплатно
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero Section ───────────────────────────────────── */}
      <section className="relative pt-40 pb-32 px-6" id="hero">
        {/* Background gradient orbs — spatial depth effect */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {/* Pink orb — top right */}
          <div
            className="absolute -top-32 -right-32 w-[600px] h-[600px] rounded-full opacity-20 blur-[120px] animate-float-slow"
            style={{ background: 'radial-gradient(circle, #ff1469 0%, transparent 70%)' }}
          />
          {/* Cyan orb — bottom left */}
          <div
            className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full opacity-15 blur-[100px] animate-float"
            style={{ background: 'radial-gradient(circle, #40D3F5 0%, transparent 70%)' }}
          />
          {/* Grid lines */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
              `,
              backgroundSize: '60px 60px',
            }}
          />
        </div>

        <div className="max-w-wrapper relative z-[1]">
          <div className="max-w-4xl mx-auto text-center">
            {/* Badge */}
            <div className="animate-fade-up inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-dark border border-melon-pink/20 mb-8">
              <span className="w-2 h-2 rounded-full bg-success-green animate-pulse" />
              <span className="text-xs text-muted-gray font-medium tracking-wider uppercase">
                Панель автоматизации v2.0
              </span>
            </div>

            {/* Main heading — ultra-wide Roboto Flex */}
            <h1 className="animate-fade-up stagger-1 text-5xl md:text-7xl lg:text-[5.5rem] leading-[1.05] mb-6">
              Загружай видео{' '}
              <span className="text-gradient-brand">
                без фрода
              </span>
            </h1>

            <p className="animate-fade-up stagger-2 text-lg md:text-xl text-muted-gray max-w-2xl mx-auto mb-10 leading-relaxed">
              Автоматическая загрузка вертикального видео на TikTok и YouTube Shorts.
              Антидетект-браузер, ротация мобильных прокси, прогрев аккаунтов —
              <span className="text-pure-white font-medium"> всё из одной панели</span>.
            </p>

            {/* CTA buttons */}
            <div className="animate-fade-up stagger-3 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/auth/register"
                className="group flex items-center gap-2 px-8 py-4 rounded-2xl bg-melon-pink text-pure-white font-semibold text-lg hover:brightness-110 transition-all duration-300 shadow-[0_0_30px_rgba(255,20,105,0.35)] hover:shadow-[0_0_50px_rgba(255,20,105,0.55)] hover:translate-y-[-2px]"
              >
                Начать работу
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="#features"
                className="flex items-center gap-2 px-8 py-4 rounded-2xl border border-muted-gray/20 text-muted-gray hover:text-pure-white hover:border-ice-cyan/40 transition-all duration-300"
              >
                <Play className="w-4 h-4" />
                Как это работает
              </a>
            </div>
          </div>

          {/* Dashboard preview with perspective tilt */}
          <div className="relative mt-20 max-w-5xl mx-auto">
            {/* Glow backdrop */}
            <div
              className="absolute inset-0 -inset-x-20 -top-10 -bottom-10 blur-[80px] opacity-20 rounded-3xl"
              style={{ background: 'linear-gradient(135deg, #ff1469 0%, #40D3F5 100%)' }}
            />
            {/* Dashboard screenshot with perspective */}
            <div
              className="animate-fade-up stagger-4 relative rounded-2xl overflow-hidden border border-pure-white/[0.06] shadow-2xl"
              style={{
                perspective: '1200px',
              }}
            >
              <div
                style={{
                  transform: 'rotateX(2deg)',
                  transformOrigin: 'center bottom',
                }}
              >
                <Image
                  src="/dashboard-preview.png"
                  alt="MelonityMedia Dashboard"
                  width={1200}
                  height={675}
                  className="w-full h-auto"
                  priority
                />
              </div>
              {/* Gradient overlay at top */}
              <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-night-base/60 to-transparent pointer-events-none" />
              {/* Gradient overlay at bottom */}
              <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-night-base to-transparent pointer-events-none" />
            </div>
            {/* Decorative floating elements */}
            <div className="absolute top-8 -left-8 w-3 h-3 rounded-full bg-ice-cyan/50 animate-float-slow" />
            <div className="absolute top-24 -right-12 w-2 h-2 rounded-full bg-melon-pink/60 animate-float" style={{ animationDelay: '1s' }} />
            <div className="absolute -bottom-4 left-1/4 w-4 h-4 rounded-full bg-ice-cyan/30 animate-float" style={{ animationDelay: '2s' }} />
          </div>
        </div>
      </section>

      {/* ── Features Grid ──────────────────────────────────── */}
      <section className="py-24 px-6 relative" id="features">
        <div className="max-w-wrapper">
          <div className="text-center mb-16">
            <h2 className="animate-fade-up text-3xl md:text-5xl text-display-wide mb-4">
              Всё для{' '}
              <span className="text-gradient-brand">арбитража</span>
            </h2>
            <p className="animate-fade-up stagger-1 text-muted-gray text-lg max-w-xl mx-auto">
              Полный набор инструментов для работы с вертикальным видеоконтентом
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Shield,
                title: 'Антидетект',
                desc: 'UndetectedChrome с патченным драйвером. Обходим все проверки TikTok и YouTube',
                color: '#ff1469',
                delay: '1',
              },
              {
                icon: Upload,
                title: 'Авто-загрузка',
                desc: 'Массовая загрузка видео на TikTok и YouTube Shorts из единой очереди',
                color: '#40D3F5',
                delay: '2',
              },
              {
                icon: Globe,
                title: 'Мобильные прокси',
                desc: 'Ротация IP через мобильные модемы. Каждый аккаунт = уникальный IP',
                color: '#ff1469',
                delay: '3',
              },
              {
                icon: RefreshCw,
                title: 'Прогрев аккаунтов',
                desc: 'Автоматическая имитация активности: скроллинг, лайки, просмотры',
                color: '#40D3F5',
                delay: '4',
              },
              {
                icon: BarChart3,
                title: 'Аналитика',
                desc: 'Сбор статистики аккаунтов: подписчики, просмотры, лайки — в реальном времени',
                color: '#ff1469',
                delay: '5',
              },
              {
                icon: Lock,
                title: 'Cookie-фарминг',
                desc: 'Автоматическое обновление cookies для поддержания живых сессий',
                color: '#40D3F5',
                delay: '6',
              },
            ].map((feature, i) => (
              <div
                key={i}
                className={`animate-fade-up stagger-${feature.delay} glass-card p-6 group hover:border-[${feature.color}]/20 transition-all duration-500 hover:translate-y-[-4px]`}
                style={{
                  boxShadow: 'none',
                  transition: 'all 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 20px 60px ${feature.color}15, 0 0 0 1px ${feature.color}25`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110"
                  style={{ background: `${feature.color}15` }}
                >
                  <feature.icon className="w-6 h-6" style={{ color: feature.color }} />
                </div>
                <h3 className="text-lg font-bold text-pure-white mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-gray leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Platforms Section ──────────────────────────────── */}
      <section className="py-24 px-6 relative" id="platforms">
        <div className="max-w-wrapper">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="animate-fade-up text-3xl md:text-5xl text-display-wide mb-6">
                Поддерживаемые{' '}
                <span className="text-gradient-brand">платформы</span>
              </h2>
              <p className="animate-fade-up stagger-1 text-muted-gray text-lg mb-8 leading-relaxed">
                Загружайте контент на популярные платформы коротких видео.
                Один аккаунт — один прокси — полная изоляция.
              </p>

              <div className="space-y-4">
                {[
                  {
                    name: 'TikTok',
                    status: 'Полная поддержка',
                    features: ['Загрузка видео', 'Прогрев', 'Аналитика', 'Cookies'],
                    color: '#ff1469',
                  },
                  {
                    name: 'YouTube Shorts',
                    status: 'Полная поддержка',
                    features: ['Загрузка Shorts', 'Cookies', 'Аналитика'],
                    color: '#40D3F5',
                  },
                ].map((platform, i) => (
                  <div
                    key={i}
                    className="animate-fade-up glass-card p-5 flex items-start gap-4 group hover:translate-x-2 transition-transform duration-300"
                    style={{ animationDelay: `${0.2 + i * 0.15}s` }}
                  >
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${platform.color}15` }}
                    >
                      <Smartphone className="w-5 h-5" style={{ color: platform.color }} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-bold text-pure-white">{platform.name}</h3>
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{ background: `${platform.color}20`, color: platform.color }}
                        >
                          {platform.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {platform.features.map((f, j) => (
                          <span key={j} className="text-xs text-muted-gray bg-night-base/80 px-2.5 py-1 rounded-md">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Visual showcase — floating device mockup */}
            <div className="relative flex justify-center">
              <div className="animate-float-slow relative">
                {/* Glow ring behind logo */}
                <div
                  className="absolute inset-0 rounded-full blur-[60px] opacity-30"
                  style={{ background: 'linear-gradient(135deg, #ff1469, #40D3F5)' }}
                />
                <Image
                  src="/logo.svg"
                  alt="Melonity Platform"
                  width={320}
                  height={320}
                  className="relative z-[1]"
                />
              </div>
              {/* Orbiting elements */}
              <div className="absolute w-full h-full animate-spin-slow">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-8 glass-card flex items-center justify-center">
                  <Upload className="w-4 h-4 text-melon-pink" />
                </div>
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-8 glass-card flex items-center justify-center">
                  <BarChart3 className="w-4 h-4 text-ice-cyan" />
                </div>
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-8 h-8 glass-card flex items-center justify-center">
                  <Shield className="w-4 h-4 text-melon-pink" />
                </div>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 glass-card flex items-center justify-center">
                  <Globe className="w-4 h-4 text-ice-cyan" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats Section ──────────────────────────────────── */}
      <section className="py-24 px-6 relative" id="stats">
        {/* Background gradient band */}
        <div
          className="absolute inset-0 opacity-5"
          style={{
            background: 'linear-gradient(180deg, transparent 0%, #ff1469 50%, transparent 100%)',
          }}
        />

        <div className="max-w-wrapper relative z-[1]">
          <div className="text-center mb-16">
            <h2 className="animate-fade-up text-3xl md:text-5xl text-display-wide mb-4">
              Масштаб,{' '}
              <span className="text-gradient-brand">который впечатляет</span>
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { value: '∞', label: 'Аккаунтов', sublabel: 'без лимитов' },
              { value: '6', label: 'Очередей', sublabel: 'BullMQ' },
              { value: '24/7', label: 'Работа', sublabel: 'автоматически' },
              { value: '0%', label: 'Фрода', sublabel: 'антидетект' },
            ].map((stat, i) => (
              <div
                key={i}
                className={`animate-fade-up stagger-${i + 1} glass-card p-6 text-center group hover:translate-y-[-4px] transition-all duration-300`}
              >
                <div className="text-4xl md:text-5xl font-bold text-display-wide text-gradient-brand mb-2">
                  {stat.value}
                </div>
                <div className="text-pure-white font-medium text-sm">{stat.label}</div>
                <div className="text-xs text-muted-gray mt-1">{stat.sublabel}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ───────────────────────────────────── */}
      <section className="py-24 px-6" id="how-it-works">
        <div className="max-w-wrapper">
          <div className="text-center mb-16">
            <h2 className="animate-fade-up text-3xl md:text-5xl text-display-wide mb-4">
              Как это{' '}
              <span className="text-gradient-brand">работает</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                icon: Cpu,
                title: 'Загрузите видео',
                desc: 'Перетащите файлы в рабочее пространство. Задайте описание, хештеги и расписание.',
                color: '#ff1469',
              },
              {
                step: '02',
                icon: Zap,
                title: 'Автоматический залив',
                desc: 'Worker берёт задачу из очереди, запускает антидетект-браузер с вашим прокси и cookies.',
                color: '#40D3F5',
              },
              {
                step: '03',
                icon: TrendingUp,
                title: 'Отслеживайте результат',
                desc: 'Реальная аналитика в дашборде: подписчики, просмотры, статусы загрузок — всё онлайн.',
                color: '#ff1469',
              },
            ].map((item, i) => (
              <div
                key={i}
                className="animate-fade-up relative glass-card p-8 group hover:translate-y-[-4px] transition-all duration-500"
                style={{ animationDelay: `${0.1 + i * 0.15}s` }}
              >
                {/* Step number */}
                <span
                  className="absolute -top-4 -left-2 text-6xl font-black opacity-10"
                  style={{ color: item.color, fontStretch: '150%' }}
                >
                  {item.step}
                </span>
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110"
                  style={{ background: `${item.color}12` }}
                >
                  <item.icon className="w-7 h-7" style={{ color: item.color }} />
                </div>
                <h3 className="text-xl font-bold text-pure-white mb-3">{item.title}</h3>
                <p className="text-sm text-muted-gray leading-relaxed">{item.desc}</p>

                {/* Connector arrow for md+ */}
                {i < 2 && (
                  <div className="hidden md:block absolute top-1/2 -right-5 text-muted-gray/30">
                    <ChevronRight className="w-6 h-6" />
                  </div>
                )}
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
              background: 'linear-gradient(135deg, rgba(255,20,105,0.08) 0%, rgba(64,211,245,0.06) 100%)',
              border: '1px solid rgba(255,20,105,0.15)',
            }}
          >
            {/* Background glow */}
            <div
              className="absolute -top-20 -right-20 w-[300px] h-[300px] rounded-full opacity-10 blur-[80px]"
              style={{ background: '#40D3F5' }}
            />
            <div
              className="absolute -bottom-20 -left-20 w-[300px] h-[300px] rounded-full opacity-10 blur-[80px]"
              style={{ background: '#ff1469' }}
            />

            <div className="relative z-[1]">
              <h2 className="animate-fade-up text-3xl md:text-5xl text-display-wide mb-4">
                Готовы{' '}
                <span className="text-gradient-brand">начать?</span>
              </h2>
              <p className="animate-fade-up stagger-1 text-muted-gray text-lg max-w-xl mx-auto mb-8">
                Зарегистрируйтесь и настройте первый аккаунт за 5 минут.
                Без привязки карты, без лимитов на тестовый период.
              </p>
              <Link
                href="/auth/register"
                className="animate-fade-up stagger-2 inline-flex items-center gap-2 px-10 py-4 rounded-2xl bg-melon-pink text-pure-white font-semibold text-lg hover:brightness-110 transition-all duration-300 shadow-[0_0_40px_rgba(255,20,105,0.4)] hover:shadow-[0_0_60px_rgba(255,20,105,0.6)] hover:translate-y-[-2px]"
              >
                Создать аккаунт
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="py-12 px-6 border-t border-muted-gray/10">
        <div className="max-w-wrapper">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <Image src="/logo.svg" alt="MelonityMedia" width={28} height={28} />
              <span className="text-sm text-muted-gray">
                © {new Date().getFullYear()} MelonityMedia. Все права защищены.
              </span>
            </div>
            <div className="flex items-center gap-6">
              <a href="#features" className="text-xs text-muted-gray hover:text-pure-white transition-colors">
                Возможности
              </a>
              <a href="#platforms" className="text-xs text-muted-gray hover:text-pure-white transition-colors">
                Платформы
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
