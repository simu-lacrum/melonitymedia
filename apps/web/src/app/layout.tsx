import type { Metadata } from 'next';
import './globals.css';
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

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
    <html lang="ru">
      <body>
        <TooltipProvider>
          {children}
        </TooltipProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#282d35',
              border: '1px solid #586271',
              color: '#FFFFFF',
            },
          }}
        />
      </body>
    </html>
  );
}
