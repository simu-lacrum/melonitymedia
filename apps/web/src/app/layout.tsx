import type { Metadata } from 'next';
import { JetBrains_Mono, Geist } from 'next/font/google';
import './globals.css';
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MelonityMedia',
  description: 'Панель автоматизации для вертикального видеоконтента — TikTok и YouTube Shorts',
  icons: {
    icon: { url: '/favicon.svg', type: 'image/svg+xml' },
    apple: '/logo.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={cn(jetbrainsMono.variable, "font-sans", geist.variable)}>
      <body>
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#181C24',
              border: '1px solid rgba(255,255,255,0.08)',
              color: '#FFFFFF',
            },
          }}
        />
      </body>
    </html>
  );
}
