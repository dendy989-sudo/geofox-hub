import type { CSSProperties } from "react";

export type IconName = "grid" | "users" | "ticket" | "pulse" | "shield" | "checklist" | "settings" | "arrow" | "search" | "refresh" | "copy" | "check" | "close" | "chevron" | "external" | "book" | "coins" | "calendar" | "clock" | "info" | "alert" | "bolt" | "logout" | "menu" | "send" | "download" | "lock" | "layers" | "globe";

const paths: Record<IconName, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3" /></>,
  ticket: <><path d="M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4V5Z" /><path d="M9 8v2m0 4v2m0 3v-1M9 5v1" /></>,
  pulse: <><path d="M2 12h5l3-8 4 16 3-8h5" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  checklist: <><rect x="5" y="4" width="15" height="17" rx="2" /><path d="M9 4V2m7 2V2m-6 8h6m-6 5h6m-9-5h.1M7 15h.1" /></>,
  settings: <><path d="m9 3-.5 3-2 1.1L4 6 2 9l2 2v2l-2 2 2 3 2.5-1 2 1 .5 3h4l.5-3 2-1 2.5 1 2-3-2-2v-2l2-2-2-3-2.5 1-2-1.1L13 3H9Z" /><circle cx="11" cy="12" r="3" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
  refresh: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" /></>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  check: <path d="m5 12 4 4L20 5" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  external: <><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" /></>,
  book: <><path d="M12 5c-3-3-7-3-10-2v16c3-1 7-1 10 2m0-16c3-3 7-3 10-2v16c-3-1-7-1-10 2V5Z" /></>,
  coins: <><ellipse cx="9" cy="6" rx="6" ry="3" /><path d="M3 6v4c0 1.6 2.7 3 6 3 1.1 0 2.1-.2 3-.4M3 10v4c0 1.6 2.7 3 6 3m5-5h7v6c0 1.7-2.7 3-6 3s-6-1.3-6-3v-6m12 0c0 1.6-2.7 3-6 3s-6-1.4-6-3 2.7-3 6-3 6 1.4 6 3Z" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 2v6m10-6v6M3 11h18m-14 4h2m6 0h2m-10 3h2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
  alert: <><path d="M11 3h2l9 17H2L11 3Z" /><path d="M12 8v5m0 3h.01" /></>,
  bolt: <path d="m14 2-10 12h7l-1 8 10-12h-7l1-8Z" />,
  logout: <><path d="M9 3H3v18h6m6-15 6 6-6 6m6-6H9" /></>,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  send: <path d="m22 2-7 20-4-9-9-4 20-7Zm0 0L11 13" />,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 4v3" /></>,
  layers: <><path d="m12 2 10 6-10 6L2 8l10-6Zm-9 11 9 5 9-5M3 17l9 5 9-5" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
};

export function Icon({ name, size = 20, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>;
}

export function GeofoxMark() {
  return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="m5 5 15 9L35 5l-3 22-12 9L8 27 5 5Z" fill="currentColor" /><path d="m8 13 12 9 12-9-3 13-9 7-9-7-3-13Z" fill="#11182b" /><path d="m15 24 5 3 5-3-5 9-5-9Z" fill="currentColor" /></svg>;
}
