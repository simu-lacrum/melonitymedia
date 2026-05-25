import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MelonityMedia',
  description: 'Панель автоматизации для вертикального видеоконтента — TikTok и YouTube Shorts',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="bg-night-base text-pure-white font-roboto-flex antialiased">
        {children}
      </body>
    </html>
  );
}
