'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

interface TerminalProps {
  logs: LogEntry[];
  className?: string;
  maxHeight?: string;
}

const LEVEL_COLORS = {
  INFO: 'text-success-green',
  WARN: 'text-warning-amber',
  ERROR: 'text-alert-red',
} as const;

export function Terminal({ logs, className, maxHeight = '400px' }: TerminalProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  return (
    <div
      className={cn(
        'bg-[#0a0a0a] rounded-xl overflow-y-auto font-mono text-xs p-4',
        className,
      )}
      style={{ maxHeight }}
    >
      {logs.length === 0 ? (
        <div className="text-muted-gray/40 text-center py-8">
          Ожидание логов...
        </div>
      ) : (
        logs.map((log, i) => (
          <div key={i} className="flex gap-2 py-0.5 leading-relaxed">
            <span className="text-muted-gray/50 shrink-0">
              {new Date(log.timestamp).toLocaleTimeString('ru-RU')}
            </span>
            <span className={cn('shrink-0 font-bold', LEVEL_COLORS[log.level])}>
              [{log.level}]
            </span>
            <span className="text-muted-gray">{log.message}</span>
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
