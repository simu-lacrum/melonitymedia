'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
// DataTable — Generic data table with checkboxes, sorting,
// and bulk actions toolbar. Type-safe via generics.
// ─────────────────────────────────────────────────────────────

interface Column<T> {
  key: string;
  label: string;
  render?: (item: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
}

interface DataTableProps<T extends { id: string }> {
  data: T[];
  columns: Column<T>[];
  bulkActions?: React.ReactNode;
  emptyState?: React.ReactNode;
  onSelectionChange?: (selectedIds: string[]) => void;
}

export function DataTable<T extends { id: string }>({
  data, columns, bulkActions, emptyState, onSelectionChange,
}: DataTableProps<T>) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const allSelected = data.length > 0 && selectedIds.size === data.length;
  const someSelected = selectedIds.size > 0;

  const toggleAll = () => {
    const next = allSelected
      ? new Set<string>()
      : new Set(data.map(d => d.id));
    setSelectedIds(next);
    onSelectionChange?.(Array.from(next));
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
    onSelectionChange?.(Array.from(next));
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = (a as any)[sortKey];
      const bVal = (b as any)[sortKey];
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="w-full">
      {/* Bulk actions toolbar */}
      {someSelected && bulkActions && (
        <div className="flex items-center gap-3 px-4 py-3 mb-2 bg-melon-pink/5 rounded-lg border border-melon-pink/20 transition-opacity duration-150 ease-out">
          <span className="text-sm text-pure-white font-medium">
            Выбрано: {selectedIds.size}
          </span>
          <div className="flex items-center gap-2 ml-auto">
            {bulkActions}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full">
          <thead>
            <tr className="border-b border-muted-gray/10">
              <th className="p-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-4 h-4 rounded accent-melon-pink cursor-pointer"
                />
              </th>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    'p-3 text-left text-xs font-medium text-muted-gray uppercase tracking-wider',
                    col.sortable && 'cursor-pointer hover:text-pure-white transition-colors duration-150 ease-out select-none',
                  )}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      <span className="text-melon-pink">
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.map(item => (
              <tr
                key={item.id}
                className={cn(
                  'border-b border-muted-gray/5 transition-[background-color] duration-150 ease-out',
                  selectedIds.has(item.id) ? 'bg-melon-pink/5' : 'hover:bg-surface-dark/50',
                )}
              >
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleOne(item.id)}
                    className="w-4 h-4 rounded accent-melon-pink cursor-pointer"
                  />
                </td>
                {columns.map(col => (
                  <td key={col.key} className="p-3 text-sm text-pure-white">
                    {col.render
                      ? col.render(item)
                      : String((item as any)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
