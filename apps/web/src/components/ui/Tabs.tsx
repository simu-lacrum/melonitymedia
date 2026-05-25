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
    <div className={cn('flex items-center gap-1 border-b border-muted-gray/10', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'px-4 py-2.5 text-sm font-medium transition-all duration-200 relative',
            'cursor-pointer hover:text-pure-white',
            activeTab === tab.id
              ? 'text-pure-white'
              : 'text-muted-gray',
          )}
        >
          {tab.label}
          {/* Active indicator — melon-pink bottom bar */}
          {activeTab === tab.id && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-melon-pink rounded-t-full" />
          )}
        </button>
      ))}
    </div>
  );
}
