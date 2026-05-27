"use client";

import * as React from "react"
import { cn } from "@/lib/utils"
import { UploadCloud } from "lucide-react"

export interface DropZoneProps extends React.HTMLAttributes<HTMLDivElement> {
  onFilesDrop?: (files: FileList) => void;
}

export function DropZone({ className, onFilesDrop, ...props }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = React.useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files && onFilesDrop) {
      onFilesDrop(e.dataTransfer.files)
    }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-card-base liquid-glass-base transition-colors cursor-pointer",
        isDragOver
          ? "border-melon-pink bg-melon-tint"
          : "border-white/10 hover:border-white/30",
        className
      )}
      {...props}
    >
      <UploadCloud
        className={cn(
          "w-12 h-12 mb-4 transition-colors",
          isDragOver ? "text-melon-pink" : "text-text-muted"
        )}
      />
      <p className="text-body-lg font-medium">
        Перетащите файлы или нажмите для выбора
      </p>
      <p className="text-body-sm text-text-muted mt-2">
        Поддерживаются видео и текстовые форматы
      </p>
    </div>
  )
}

