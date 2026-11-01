import type { ResizeHandleProps } from './useResizableWidth';

/** The draggable divider: a wide hit area with a thin line that lights up. */
export function ResizeHandle({ label, className = '', ...props }: ResizeHandleProps & { label: string; className?: string }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className={`group relative w-3 shrink-0 cursor-col-resize touch-none outline-none flex justify-center ${className}`}
      {...props}
    >
      <div className="w-px h-full bg-gray-200 group-hover:w-1 group-hover:bg-blue-400 group-focus-visible:w-1 group-focus-visible:bg-blue-500 group-active:w-1 group-active:bg-blue-500 transition-all rounded-full" />
    </div>
  );
}
