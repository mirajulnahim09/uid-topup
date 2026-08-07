'use client';

import MediaBrowser from './MediaBrowser';

/**
 * ★ MediaPicker — ফর্মে "লাইব্রেরি থেকে বেছে নিন" মডাল।
 *   যেকোনো ফর্মে (প্রোডাক্ট/ব্যানার/ক্যাম্পেইন) পুনঃব্যবহারযোগ্য।
 *   একবার আপলোড করা ছবি বারবার ব্যবহার করা যায় — নতুন আপলোড না করেই।
 */
export default function MediaPicker({
  open, onClose, onPick, defaultFolder = '',
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: { url: string; alt: string | null }) => void;
  defaultFolder?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(0,0,0,.55)' }} onClick={onClose}>
      <div
        className="mt-8 w-full max-w-5xl rounded-2xl p-5"
        style={{ background: 'var(--v-pit)', border: '1px solid var(--v-edge2)', boxShadow: 'var(--v-shadow-3)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--v-ink)' }}>লাইব্রেরি থেকে বেছে নিন</h3>
            <p className="text-xs" style={{ color: 'var(--v-mut)' }}>ছবিতে ক্লিক করে বেছে নিন, অথবা নতুন আপলোড করুন।</p>
          </div>
          <button onClick={onClose} aria-label="বন্ধ" className="grid h-9 w-9 place-items-center rounded-lg" style={{ color: 'var(--v-mut)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <MediaBrowser mode="pick" defaultFolder={defaultFolder} onPick={(m) => { onPick(m); onClose(); }} />
      </div>
    </div>
  );
}
