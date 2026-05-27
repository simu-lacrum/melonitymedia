import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MelonityMedia',
  description: 'Панель автоматизации для вертикального видеоконтента — TikTok и YouTube Shorts',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
