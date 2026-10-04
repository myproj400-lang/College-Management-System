import type { ReactNode } from 'react';

export function Icon({ name }: { name: string }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, ReactNode> = {
    home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />,
    file: <><path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" /><path d="M14 3.5V9h5" /></>,
    users: <><path d="M16 20v-1.2A3.8 3.8 0 0 0 12.2 15H7.8A3.8 3.8 0 0 0 4 18.8V20" /><circle cx="10" cy="8" r="3" /><path d="M20 20v-1.1A3.4 3.4 0 0 0 17.2 15.6" /><path d="M16 5.2a2.6 2.6 0 0 1 0 5" /></>,
    book: <><path d="M12 6C9 3.5 5 3.5 2 4.5V20c3-1 7-1 10 1 3-2 7-2 10-1V4.5c-3-1-7-1-10 1.5Z" /><path d="M12 6v15" /></>,
    screen: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
    chart: <path d="M4 19h16M7 16V9M12 16V5M17 16v-4" />,
    calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M8 3.5V7M16 3.5V7M3.5 10h17" /></>,
    user: <><circle cx="12" cy="8" r="3.2" /><path d="M5 19.5a7 7 0 0 1 14 0" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16.5 20 20.5" /></>,
    bell: <><path d="M6 16.5h12l-1.2-1.6V10a4.8 4.8 0 0 0-9.6 0v4.9z" /><path d="M10 18.5a2 2 0 0 0 4 0" /></>,
    cap: <><path d="M3 10 12 5l9 5-9 5z" /><path d="M7 12.2V16c1.6 1.3 3.2 2 5 2s3.4-.7 5-2v-3.8" /></>,
    check: <path d="M5 12.5 9.2 17 19 7" />,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4.5l3 2" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="m3 6 9 7 9-7" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="1" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    chevron: <path d="m8 5 7 7-7 7" />,
    down: <path d="m6 9 6 6 6-6" />,
    warning: <><path d="m12 3 10 18H2Z" /><path d="M12 9v5m0 3v.5" /></>,
    shield: <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z" /><path d="m8 11 3 3 5-6" /></>,
    trophy: <><path d="M7 3h10v7a5 5 0 0 1-10 0ZM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4M12 15v5m-5 1h10" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  };
  return (
    <svg className="icon" aria-hidden="true" {...common}>
      {paths[name] ?? paths.file}
    </svg>
  );
}

export function Mark() {
  return (
    <span className="mark" aria-hidden="true"><svg viewBox="0 0 80 80" fill="none"><path d="M7 44 10 68c13-3 22-1 30 6 8-7 17-9 30-6l3-24" stroke="currentColor" strokeWidth="3" /><path d="M14 42v20c11-1 20 3 26 8V45c-8-6-16-7-26-3Zm52 0v20c-11-1-20 3-26 8V45c8-6 16-7 26-3Z" fill="currentColor" /><path d="m9 22 31-14 31 14-31 14Z" fill="currentColor" /><path d="M23 33v9l17 8 17-8v-9M69 24v22" stroke="currentColor" strokeWidth="3" /><path d="M10 72c12-3 22-1 30 5 8-6 18-8 30-5" stroke="#e5ba56" strokeWidth="3" /></svg></span>
  );
}
