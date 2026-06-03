'use client';

import { useState, useRef, useCallback, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DropZoneProps {
  accept?: string;
  multiple?: boolean;
  onDrop: (files: File[]) => void;
  label?: string;
  className?: string;
}

export function DropZone({
  accept, multiple = true, onDrop,
  label = 'Перетащите файлы сюда или нажмите для выбора',
  className,
}: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onDrop(files);
  }, [onDrop]);

  const handleClick = () => inputRef.current?.click();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) onDrop(files);
    // Reset so the same file can be selected again
    e.target.value = '';
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-3 p-8 rounded-2xl',
        'border-2 border-dashed cursor-pointer transition-[border-color,background-color] duration-200 ease-out',
        isDragOver
          ? 'border-melon-pink bg-melon-pink/5 scale-[1.01]'
          : 'border-muted-gray/30 hover:border-muted-gray/60',
        className,
      )}
    >
      <Upload className={cn(
        'w-8 h-8 transition-colors',
        isDragOver ? 'text-melon-pink' : 'text-muted-gray',
      )} />
      <p className={cn(
        'text-sm text-center transition-colors',
        isDragOver ? 'text-pure-white' : 'text-muted-gray',
      )}>
        {label}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleInputChange}
        className="hidden"
      />
    </div>
  );
}
