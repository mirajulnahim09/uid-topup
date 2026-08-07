export const SOCIAL_META: Record<string, { label: string; color: string; path: string }> = {
  facebook: {
    label: 'Facebook',
    color: 'hover:bg-[#1877F2]/20 hover:text-[#1877F2] hover:border-[#1877F2]/40',
    path: 'M22 12a10 10 0 10-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0022 12z',
  },
  messenger: {
    label: 'Messenger',
    color: 'hover:bg-[#0084FF]/20 hover:text-[#0084FF] hover:border-[#0084FF]/40',
    path: 'M12 2C6.4 2 2 6.1 2 11.6c0 2.9 1.2 5.4 3.2 7.1v3.5l3-1.6c.8.2 1.7.3 2.6.3h1.2c5.6 0 10-4.1 10-9.6S17.6 2 12 2zm1 12.9l-2.6-2.8-5 2.8L10.9 9l2.6 2.8 5-2.8-5.5 5.9z',
  },
  youtube: {
    label: 'YouTube',
    color: 'hover:bg-[#FF0000]/20 hover:text-[#FF0000] hover:border-[#FF0000]/40',
    path: 'M23 12s0-3.2-.4-4.7a2.5 2.5 0 00-1.8-1.8C19.3 5 12 5 12 5s-7.3 0-8.8.5A2.5 2.5 0 001.4 7.3C1 8.8 1 12 1 12s0 3.2.4 4.7a2.5 2.5 0 001.8 1.8C4.7 19 12 19 12 19s7.3 0 8.8-.5a2.5 2.5 0 001.8-1.8C23 15.2 23 12 23 12zM9.8 15V9l6.2 3-6.2 3z',
  },
  whatsapp: {
    label: 'WhatsApp',
    color: 'hover:bg-[#25D366]/20 hover:text-[#25D366] hover:border-[#25D366]/40',
    path: 'M17.5 14.4c-.3-.2-1.8-.9-2-1-.3-.1-.5-.2-.7.1s-.8 1-.9 1.2c-.2.2-.3.2-.6.1a8 8 0 01-2.4-1.5 9 9 0 01-1.6-2c-.2-.3 0-.5.1-.6l.5-.6.3-.5v-.5c0-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.5.3-.7.3-1.3.2-1.4-.1-.2-.3-.2-.6-.4zM12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 18.3c-1.5 0-3-.4-4.3-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.3 8.3 0 1112 20.3z',
  },
  telegram: {
    label: 'Telegram',
    color: 'hover:bg-[#26A5E4]/20 hover:text-[#26A5E4] hover:border-[#26A5E4]/40',
    path: 'M12 2a10 10 0 100 20 10 10 0 000-20zm4.6 6.9l-1.6 7.5c-.1.5-.4.7-.9.4l-2.4-1.8-1.2 1.1c-.1.1-.2.2-.5.2l.2-2.5 4.5-4.1c.2-.2 0-.3-.3-.1L8.9 12.6l-2.4-.8c-.5-.2-.5-.5.1-.8l9.3-3.6c.4-.2.8.1.7.5z',
  },
  tiktok: {
    label: 'TikTok',
    color: 'hover:bg-white/15 hover:text-slate-900 hover:border-white/30',
    path: 'M20 8.7a6.6 6.6 0 01-4.2-1.5v6.9a5.7 5.7 0 11-5.7-5.7c.3 0 .6 0 .8.1v2.9a2.9 2.9 0 101.9 2.7V2h2.9a3.9 3.9 0 004.2 3.7v3z',
  },
  instagram: {
    label: 'Instagram',
    color: 'hover:bg-[#E4405F]/20 hover:text-[#E4405F] hover:border-[#E4405F]/40',
    path: 'M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9-.1-1.3-.1-1.6-.1-4.8s0-3.6.1-4.8C2.4 4 4 2.4 7.2 2.3c1.2-.1 1.6-.1 4.8-.1zm0 5.6a4.2 4.2 0 100 8.4 4.2 4.2 0 000-8.4zm0 6.9a2.7 2.7 0 110-5.4 2.7 2.7 0 010 5.4zm5.3-7a1 1 0 11-2 0 1 1 0 012 0z',
  },
  discord: {
    label: 'Discord',
    color: 'hover:bg-[#5865F2]/20 hover:text-[#5865F2] hover:border-[#5865F2]/40',
    path: 'M19.6 5.9A16 16 0 0015.6 4.7l-.2.4a15 15 0 00-6.8 0l-.2-.4A16 16 0 004.4 5.9C1.9 9.6 1.2 13.3 1.5 16.9a16 16 0 005 2.5l.9-1.6c-.6-.2-1.2-.5-1.7-.8l.4-.3a11.4 11.4 0 009.8 0l.4.3c-.5.3-1.1.6-1.7.8l.9 1.6a16 16 0 005-2.5c.4-4.2-.7-7.9-2.9-11zM8.5 14.7c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z',
  },
  x: {
    label: 'X (Twitter)',
    color: 'hover:bg-white/15 hover:text-slate-900 hover:border-white/30',
    path: 'M18.2 2H21l-6.5 7.4L22 22h-6l-4.7-6.1L5.9 22H3l7-8-7.3-12h6.2l4.2 5.6L18.2 2zm-1 18.3h1.6L7.4 3.6H5.6l11.6 16.7z',
  },
};

export function SocialIcon({ platform, size = 18 }: { platform: string; size?: number }) {
  const m = SOCIAL_META[platform];
  if (!m) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={m.path} />
    </svg>
  );
}
