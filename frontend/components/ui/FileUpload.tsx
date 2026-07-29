"use client";

import * as React from "react";
import { UploadCloud, FileText, Image as ImageIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface UploadedFile {
  id: string;
  fileName: string;
  sizeKb: number;
  mimeType: string;
}

export interface FileUploadProps {
  files: UploadedFile[];
  onAdd?: (fileName: string) => void;
  onRemove?: (id: string) => void;
  label?: string;
  helper?: string;
  className?: string;
}

// Mock-only: no real upload. Selecting a file records its metadata.
export function FileUpload({
  files,
  onAdd,
  onRemove,
  label = "Receipts",
  helper = "PDF, JPG or PNG up to 10 MB. Drag and drop or browse.",
  className,
}: FileUploadProps) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function handleFiles(list: FileList | null) {
    if (!list) return;
    Array.from(list).forEach((f) => onAdd?.(f.name));
  }

  return (
    <div className={cn("space-y-3", className)}>
      {label && <span className="block text-sm font-medium text-on-surface">{label}</span>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-200 ease-m3",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          dragging
            ? "border-primary bg-primary/5"
            : "border-outline bg-surface-container-high hover:bg-surface-container"
        )}
      >
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UploadCloud className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="text-sm font-medium text-on-surface">
          Drop files here or <span className="text-primary">browse</span>
        </span>
        <span className="text-xs text-on-surface-variant">{helper}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </button>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f) => {
            const isImage = f.mimeType.startsWith("image/");
            const Icon = isImage ? ImageIcon : FileText;
            return (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant">
                  <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-on-surface">{f.fileName}</p>
                  <p className="text-xs text-on-surface-variant">{f.sizeKb} KB</p>
                </div>
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(f.id)}
                    aria-label={`Remove ${f.fileName}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                  >
                    <X className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
