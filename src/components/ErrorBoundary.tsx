'use client';

import { Component, type ReactNode } from 'react';

/** ★ একটা কম্পোনেন্ট ক্র্যাশ করলে পুরো সাদা পাতা যেন না আসে */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="card max-w-md p-7 text-center">
          <div className="mb-3 text-4xl" aria-hidden="true">⚠️</div>
          <h1 className="text-lg font-bold text-slate-900">কিছু একটা সমস্যা হয়েছে</h1>
          <p className="mt-2 text-sm text-slate-400">
            পাতাটি রিলোড করে আবার চেষ্টা করুন।
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button
              onClick={() => this.setState({ hasError: false })}
              className="btn-ghost"
            >
              আবার চেষ্টা
            </button>
            <button onClick={() => window.location.reload()} className="btn-primary">
              রিলোড
            </button>
          </div>
        </div>
      </div>
    );
  }
}
