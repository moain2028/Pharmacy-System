import type { SVGProps } from "react";

/** Minimal 24px stroke icon set (Lucide-style, inline so the desktop build has zero network deps). */
type P = SVGProps<SVGSVGElement>;
const I = ({ children, ...p }: P) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{children}</svg>
);

export const Icons = {
  dashboard: (p: P) => <I {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></I>,
  pos: (p: P) => <I {...p}><path d="M3 7h18l-1.5 12.5a1 1 0 0 1-1 .5H5.5a1 1 0 0 1-1-.5L3 7Z" /><path d="M8 7V5a4 4 0 0 1 8 0v2" /></I>,
  sales: (p: P) => <I {...p}><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></I>,
  returns: (p: P) => <I {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></I>,
  customers: (p: P) => <I {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4.5-6.2" /></I>,
  items: (p: P) => <I {...p}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" /></I>,
  inventory: (p: P) => <I {...p}><path d="M3 9.5 12 4l9 5.5V20H3z" /><path d="M9 20v-6h6v6" /></I>,
  expiry: (p: P) => <I {...p}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5" /><path d="M9 2h6" /></I>,
  purchasing: (p: P) => <I {...p}><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8H18a1 1 0 0 0 1-.8L21 8H6" /><circle cx="9" cy="20" r="1.2" /><circle cx="17" cy="20" r="1.2" /></I>,
  suppliers: (p: P) => <I {...p}><path d="M3 17V7l7-4v18" /><path d="M10 9h8a3 3 0 0 1 3 3v9h-11" /><path d="M14 13h3M14 17h3" /></I>,
  payables: (p: P) => <I {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /><path d="M7 15h3" /></I>,
  cash: (p: P) => <I {...p}><rect x="2" y="7" width="20" height="11" rx="2" /><circle cx="12" cy="12.5" r="2.5" /><path d="M6 7V5h12v2" /></I>,
  expenses: (p: P) => <I {...p}><path d="M4 19h16" /><path d="M5 16 10 10l4 3 5-7" /></I>,
  reports: (p: P) => <I {...p}><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></I>,
  accounting: (p: P) => <I {...p}><path d="M12 3v18" /><path d="M5 7h14" /><path d="m5 7-3 6a3 3 0 0 0 6 0zM19 7l-3 6a3 3 0 0 0 6 0z" /></I>,
  users: (p: P) => <I {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></I>,
  settings: (p: P) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></I>,
  menu: (p: P) => <I {...p}><path d="M4 7h16M4 12h16M4 17h16" /></I>,
  close: (p: P) => <I {...p}><path d="M6 6l12 12M18 6 6 18" /></I>,
  search: (p: P) => <I {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></I>,
  logout: (p: P) => <I {...p}><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="m15 8 5 4-5 4M20 12H9" /></I>,
  globe: (p: P) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></I>,
  chevron: (p: P) => <I {...p}><path d="m9 6 6 6-6 6" /></I>,
  more: (p: P) => <I {...p}><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></I>,
  alert: (p: P) => <I {...p}><path d="m12 3 10 18H2z" /><path d="M12 10v4M12 18h.01" /></I>,
  check: (p: P) => <I {...p}><path d="m4 12 5 5L20 6" /></I>,
  plus: (p: P) => <I {...p}><path d="M12 5v14M5 12h14" /></I>,
  print: (p: P) => <I {...p}><path d="M6 9V3h12v6" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M6 14h12v7H6z" /></I>,
  refresh: (p: P) => <I {...p}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></I>,
  arrowUp: (p: P) => <I {...p}><path d="M12 19V5M5 12l7-7 7 7" /></I>,
  arrowDown: (p: P) => <I {...p}><path d="M12 5v14M5 12l7 7 7-7" /></I>,
  pill: (p: P) => <I {...p}><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" /><path d="m8.5 8.5 7 7" /></I>,
} as const;
export type IconName = keyof typeof Icons;
