/** Pulsing skeleton card shown while panel data is loading. */
export function LoadingCard() {
  return (
    <div className="rounded-xl border border-white/5 bg-bg-card p-6 animate-pulse space-y-5">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div className="h-5 w-40 bg-white/10 rounded-md" />
        <div className="h-4 w-24 bg-white/5 rounded-md" />
      </div>
      {/* Score mock */}
      <div className="flex items-end gap-3">
        <div className="h-14 w-28 bg-white/10 rounded-lg" />
        <div className="space-y-2 pb-1">
          <div className="h-3 w-20 bg-white/5 rounded" />
          <div className="h-3 w-16 bg-white/5 rounded" />
        </div>
      </div>
      {/* Divider */}
      <div className="border-t border-white/5" />
      {/* Table rows */}
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex gap-3 items-center">
          <div className="h-3 flex-1 bg-white/5 rounded" />
          <div className="h-3 w-10 bg-white/5 rounded" />
          <div className="h-3 w-14 bg-white/5 rounded" />
          <div className="h-3 w-12 bg-white/5 rounded" />
        </div>
      ))}
    </div>
  );
}
