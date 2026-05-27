import type { Metadata } from 'next';
import { Roboto_Flex, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const robotoFlex = Roboto_Flex({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-roboto-flex',
  axes: ['wdth', 'GRAD', 'opsz', 'slnt'],
  display: 'swap',
});

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
    <html lang="ru" className={`${robotoFlex.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
