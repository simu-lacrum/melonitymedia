'use client';

import { cn } from '@/lib/utils';

interface Tab {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onTabChange, className }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-pure-white/[0.05]', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'px-4 py-2.5 text-xs font-bold uppercase tracking-widest transition-all duration-300 relative',
            'cursor-pointer hover:text-pure-white',
            activeTab === tab.id
              ? 'text-pure-white'
              : 'text-muted-gray/70',
          )}
        >
          {tab.label}
          {/* Active indicator — strict pure white bottom bar */}
          {activeTab === tab.id && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-pure-white" />
          )}
        </button>
      ))}
    </div>
  );
}
