/** A chevron big enough to notice: points right when collapsed, down when open. */
export function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-md border border-gray-300 bg-white text-gray-600 group-hover:border-gray-500 group-hover:text-gray-900"
    >
      <svg
        viewBox="0 0 20 20"
        className={`w-5 h-5 transition-transform ${collapsed ? '' : 'rotate-90'}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7.5 4.5 13 10l-5.5 5.5" />
      </svg>
    </span>
  );
}
