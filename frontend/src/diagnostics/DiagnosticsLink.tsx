import { Activity, ArrowUpRight } from 'lucide-react';

export function DiagnosticsLink() {
  return (
    <a
      href="/diagnostics"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      title="Open diagnostics in a new tab"
    >
      <Activity className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Diagnostics</span>
      <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}
