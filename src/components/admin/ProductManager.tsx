'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';
import ImageUploader from '@/components/ImageUploader';
import MediaPicker from '@/components/admin/MediaPicker';

type V = {
  id: number; label: string; price: number; costPrice: number;
  oldPrice: number | null; stock: number; isActive: boolean; isPopular: boolean;
};
type P = {
  id: number; name: string; image: string | null; description: string | null;
  uidLabel: string; uidHint: string | null; isActive: boolean; variants: V[];
  deliveryType?: string;
};
type C = { id: number; name: string; products: P[] };

type Edit = {
  label: string; price: string; costPrice: string; oldPrice: string; stock: string;
};

const BLANK_PRODUCT = {
  categoryId: '', name: '', description: '',
  uidLabel: 'Player UID', uidHint: '', image: null as string | null,
  deliveryType: 'TOPUP',
};
const BLANK_VARIANT = { label: '', price: '', costPrice: '', stock: '-1' };

export default function ProductManager({ categories }: { categories: C[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [busy, setBusy] = useState<number | string | null>(null);
  const [edit, setEdit] = useState<Record<number, Edit>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});   // কোন প্রোডাক্ট খোলা
  const [imgFor, setImgFor] = useState<P | null>(null);
  const [addVar, setAddVar] = useState<P | null>(null);
  const [newVar, setNewVar] = useState(BLANK_VARIANT);
  const [newProd, setNewProd] = useState(BLANK_PRODUCT);
  // ★ মিডিয়া লাইব্রেরি থেকে কভার বেছে নেওয়া (নতুন / সম্পাদনা)
  const [pickTarget, setPickTarget] = useState<'new' | 'edit' | null>(null);
  const [showNewProd, setShowNewProd] = useState(false);
  const [delVar, setDelVar] = useState<{ v: V; p: P } | null>(null);
  const [delProd, setDelProd] = useState<P | null>(null);
  const [editProd, setEditProd] = useState<P | null>(null);

  /** ★ instant refresh — UI ব্লক হয় না */
  function refresh() {
    startTransition(() => router.refresh());
  }

  async function api(
    url: string,
    method: string,
    body: unknown,
    msg: string,
    key: number | string
  ) {
    setBusy(key);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(msg);
      refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
      return false;
    } finally {
      setBusy(null);
    }
  }

  // ─── প্যাকেজ (variant) ───
  function startEdit(v: V) {
    setEdit({
      ...edit,
      [v.id]: {
        label: v.label,
        price: String(v.price),
        costPrice: String(v.costPrice),
        oldPrice: v.oldPrice ? String(v.oldPrice) : '',
        stock: String(v.stock),
      },
    });
  }

  function cancelEdit(id: number) {
    const n = { ...edit };
    delete n[id];
    setEdit(n);
  }

  async function saveVariant(id: number) {
    const e = edit[id];
    if (!e) return;
    if (!e.label.trim()) return toast.error('প্যাকেজের নাম দিন');

    const price = Number(e.price);
    if (isNaN(price) || price <= 0) return toast.error('সঠিক বিক্রয় মূল্য দিন');

    const ok = await api(
      '/api/admin/variant',
      'PATCH',
      {
        id,
        label: e.label,
        price: e.price,
        costPrice: e.costPrice,
        oldPrice: e.oldPrice || null,
        stock: e.stock,
      },
      'দাম সেভ হয়েছে',
      id
    );
    if (ok) cancelEdit(id);
  }

  async function createVariant() {
    if (!addVar) return;
    if (!newVar.label.trim()) return toast.error('প্যাকেজের নাম দিন');
    const price = Number(newVar.price);
    if (isNaN(price) || price <= 0) return toast.error('সঠিক দাম দিন');

    const ok = await api(
      '/api/admin/variant',
      'POST',
      { productId: addVar.id, ...newVar },
      'প্যাকেজ যোগ হয়েছে',
      `nv-${addVar.id}`
    );
    if (ok) {
      setAddVar(null);
      setNewVar(BLANK_VARIANT);
    }
  }

  // ─── প্রোডাক্ট ───
  async function createProduct() {
    if (!newProd.categoryId) return toast.error('ক্যাটাগরি বেছে নিন');
    if (newProd.name.trim().length < 2) return toast.error('প্রোডাক্টের নাম দিন');

    const ok = await api(
      '/api/admin/product',
      'POST',
      {
        categoryId: Number(newProd.categoryId),
        name: newProd.name.trim(),
        description: newProd.description.trim(),
        uidLabel: newProd.uidLabel.trim() || 'Player UID',
        uidHint: newProd.uidHint.trim(),
        image: newProd.image,
        deliveryType: newProd.deliveryType,
      },
      'প্রোডাক্ট তৈরি হয়েছে — এখন প্যাকেজ যোগ করুন',
      'np'
    );
    if (ok) {
      setNewProd(BLANK_PRODUCT);
      setShowNewProd(false);
    }
  }

  async function saveProduct() {
    if (!editProd) return;
    if (editProd.name.trim().length < 2) return toast.error('প্রোডাক্টের নাম দিন');

    const ok = await api(
      '/api/admin/product',
      'PATCH',
      {
        id: editProd.id,
        name: editProd.name.trim(),
        description: editProd.description ?? '',
        uidLabel: editProd.uidLabel.trim() || 'Player UID',
        uidHint: editProd.uidHint ?? '',
        deliveryType: editProd.deliveryType ?? 'TOPUP',
      },
      'প্রোডাক্ট সেভ হয়েছে',
      editProd.id
    );
    if (ok) setEditProd(null);
  }

  const allProducts = categories.flatMap((c: C) => c.products);

  return (
    <div className="space-y-6">
      {/* ── কীভাবে কাজ করে ── */}
      <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
        <p className="text-sm leading-relaxed text-blue-800">
          <strong>💡 দাম বদলাতে:</strong> প্রোডাক্টে ক্লিক করে খুলুন → প্যাকেজের পাশে
          <strong> ✎ এডিট</strong> চাপুন → নতুন দাম লিখে <strong>সেভ</strong>। সাথে সাথেই
          সাইটে দেখাবে। <em>পুরনো অর্ডারে পুরনো দামই থাকবে</em> — হিসাব ঠিক থাকবে।
        </p>
      </div>

      {/* ── নতুন প্রোডাক্ট ── */}
      {showNewProd ? (
        <section className="card border-2 border-purple-300 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">নতুন প্রোডাক্ট</h2>
            <button
              onClick={() => {
                setShowNewProd(false);
                setNewProd(BLANK_PRODUCT);
              }}
              className="btn-ghost px-3 py-1 text-xs"
            >
              ✕ বন্ধ
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <ImageUploader
                value={newProd.image}
                onChange={(url) => setNewProd({ ...newProd, image: url })}
                folder="products"
                label="কভার ছবি"
                aspect="aspect-square"
                cropAspect={1}
                hint="বর্গাকার কভার — টেনে আনুন, অবস্থান ঠিক করে সেভ করুন (WebP-এ অপ্টিমাইজ হবে)"
              />
              <button type="button" onClick={() => setPickTarget('new')} className="btn-ghost mt-2 w-full text-xs">
                📚 লাইব্রেরি থেকে বেছে নিন
              </button>
            </div>

            <div className="space-y-3 lg:col-span-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">ক্যাটাগরি</label>
                  <select aria-label="ক্যাটাগরি"
                    className="input"
                    value={newProd.categoryId}
                    onChange={(e) => setNewProd({ ...newProd, categoryId: e.target.value })}
                  >
                    <option value="">— বেছে নিন —</option>
                    {categories.map((c: C) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label">প্রোডাক্টের নাম</label>
                  <input aria-label="প্রোডাক্টের নাম"
                    className="input"
                    value={newProd.name}
                    onChange={(e) => setNewProd({ ...newProd, name: e.target.value })}
                    placeholder="যেমন: Free Fire [BD SERVER]"
                  />
                </div>

                <div>
                  <label className="label">কী চাইবে (UID লেবেল)</label>
                  <input aria-label="কী চাইবে (UID লেবেল)"
                    className="input"
                    value={newProd.uidLabel}
                    onChange={(e) => setNewProd({ ...newProd, uidLabel: e.target.value })}
                    placeholder="Player UID"
                  />
                </div>

                <div>
                  <label className="label">ডেলিভারির ধরন</label>
                  <select aria-label="ডেলিভারির ধরন" className="input"
                    value={newProd.deliveryType}
                    onChange={(e) => setNewProd({ ...newProd, deliveryType: e.target.value })}>
                    <option value="TOPUP">টপ-আপ (গেম আইডিতে পাঠানো)</option>
                    <option value="CODE">কোড (স্টক থেকে অটো-ডেলিভারি)</option>
                  </select>
                </div>

                <div>
                  <label className="label">ছোট বর্ণনা</label>
                  <input aria-label="ছোট বর্ণনা"
                    className="input"
                    value={newProd.description}
                    onChange={(e) => setNewProd({ ...newProd, description: e.target.value })}
                    placeholder="FREE FIRE"
                  />
                </div>
              </div>

              <div>
                <label className="label">কাস্টমারকে সাহায্য (ঐচ্ছিক)</label>
                <input aria-label="কাস্টমারকে সাহায্য (ঐচ্ছিক)"
                  className="input"
                  value={newProd.uidHint}
                  onChange={(e) => setNewProd({ ...newProd, uidHint: e.target.value })}
                  placeholder="গেমের প্রোফাইল থেকে UID কপি করুন"
                />
              </div>

              <button
                onClick={createProduct}
                disabled={busy === 'np'}
                className="btn-primary w-full py-3"
              >
                {busy === 'np' ? 'তৈরি হচ্ছে...' : 'প্রোডাক্ট তৈরি করুন'}
              </button>

              <p className="text-xs text-slate-500">
                তৈরির পর প্রোডাক্ট খুলে &ldquo;+ নতুন প্যাকেজ&rdquo; দিয়ে দাম যোগ করুন।
              </p>
            </div>
          </div>
        </section>
      ) : (
        <button onClick={() => setShowNewProd(true)} className="btn-primary">
          + নতুন প্রোডাক্ট যোগ করুন
        </button>
      )}

      {/* ── প্রোডাক্ট তালিকা ── */}
      {categories.map((c: C) => (
        <section key={c.id}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-500">
            <span className="h-4 w-1 rounded bg-purple-500" aria-hidden="true" />
            {c.name}
            <span className="font-normal text-slate-400">({c.products.length}টি)</span>
          </h2>

          <div className="space-y-3">
            {c.products.map((p: P) => {
              const isOpen = open[p.id] ?? false;

              return (
                <div key={p.id} className="card overflow-hidden">
                  {/* ── হেডার — ক্লিক করলে খোলে/বন্ধ হয় ── */}
                  <div className="flex flex-wrap items-center gap-3 bg-slate-50 px-4 py-3">
                    <button
                      onClick={() => setImgFor(p)}
                      aria-label={`${p.name} এর ছবি বদলান`}
                      className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 border-slate-200 bg-white"
                    >
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-xl opacity-40">💎</span>
                      )}
                      <span className="absolute inset-0 grid place-items-center bg-slate-900/70 text-[9px] font-bold text-white opacity-0 transition group-hover:opacity-100">
                        ছবি<br />বদলান
                      </span>
                    </button>

                    <button
                      onClick={() => setOpen({ ...open, [p.id]: !isOpen })}
                      /* ★★★ `min-w-0` নয়, একটি **ন্যূনতম প্রস্থ**।
                         সারিটি `flex-wrap`, কিন্তু `min-w-0` এই বোতামকে
                         শূন্য পর্যন্ত চাপতে দিত — তাই wrap হওয়ার সুযোগই
                         আসত না, বদলে শিরোনামটি সরু হয়ে যেত। ৩৬০×৬৪০
                         ফোনে অডিটে মাপা: প্রস্থ **৯–১১px**, উচ্চতা
                         ৩১৫–৩৬৩px — অর্থাৎ লেখা প্রতি লাইনে এক অক্ষর।
                         (৩২০px-এ হতো না, কারণ সেখানে সারিটি এমনিতেই
                         wrap করত; ৩৭৫px-এ জায়গা ছিল।) ন্যূনতম প্রস্থ
                         থাকলে অ্যাকশন-বোতামগুলো নিচের সারিতে নামে আর
                         শিরোনাম পুরো প্রস্থ পায়। `truncate` অক্ষত। */
                      className="min-w-[10rem] flex-1 text-left"
                    >
                      <p className="truncate font-bold text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        {p.variants.length} টি প্যাকেজ · {p.uidLabel}
                        {p.variants.length > 0 && (
                          <>
                            {' · '}
                            <span className="font-semibold text-rose-600">
                              ৳{Math.min(...p.variants.map((v: V) => v.price)).toFixed(0)} থেকে
                            </span>
                          </>
                        )}
                      </p>
                    </button>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => setEditProd({ ...p })}
                        title="নাম / বর্ণনা বদলান"
                        className="btn-ghost px-2.5 py-1.5 text-xs"
                      >
                        ✎
                      </button>

                      <button
                        disabled={busy === -p.id}
                        onClick={() =>
                          api(
                            '/api/admin/product',
                            'PATCH',
                            { id: p.id, isActive: !p.isActive },
                            p.isActive ? 'প্রোডাক্ট লুকানো হলো' : 'প্রোডাক্ট দেখাচ্ছে',
                            -p.id
                          )
                        }
                        className={`badge ${
                          p.isActive
                            ? 'border border-emerald-200 bg-emerald-100 text-emerald-700'
                            : 'border border-slate-200 bg-slate-100 text-slate-500'
                        }`}
                      >
                        {p.isActive ? '👁 দেখাচ্ছে' : '🚫 লুকানো'}
                      </button>

                      <button
                        onClick={() => setDelProd(p)}
                        title="প্রোডাক্ট মুছুন"
                        className="btn-danger px-2.5 py-1.5 text-xs"
                      >
                        🗑
                      </button>

                      <button
                        onClick={() => setOpen({ ...open, [p.id]: !isOpen })}
                        aria-label={isOpen ? 'বন্ধ করুন' : 'দাম দেখুন'}
                        aria-expanded={isOpen}
                        className="btn-ghost px-2.5 py-1.5 text-xs"
                      >
                        {isOpen ? '▲' : '▼ দাম'}
                      </button>
                    </div>
                  </div>

                  {/* ── প্যাকেজ ও দাম ── */}
                  {isOpen && (
                    <div className="animate-fade-up">
                      {p.variants.length === 0 ? (
                        <p className="px-4 py-8 text-center text-sm text-slate-400">
                          কোনো প্যাকেজ নেই — নিচে থেকে যোগ করুন
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th scope="col">প্যাকেজ</th>
                                <th scope="col" className="num">বিক্রয় দাম</th>
                                <th scope="col" className="num">ক্রয় দাম</th>
                                <th scope="col" className="num">কাটা দাম</th>
                                <th scope="col" className="num">লাভ</th>
                                <th scope="col" className="num">স্টক</th>
                                <th scope="col">ট্যাগ</th>
                                <th scope="col" className="ctr">অ্যাকশন</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.variants.map((v: V) => {
                                const e = edit[v.id];
                                const profit = v.price - v.costPrice;
                                const margin =
                                  v.price > 0 ? ((profit / v.price) * 100).toFixed(0) : '0';

                                return (
                                  <tr key={v.id} className={e ? 'bg-amber-50' : ''}>
                                    <td>
                                      {e ? (
                                        <input
                                          aria-label={`${v.label} — প্যাকেজের নাম`}
                                          className="input w-32 py-1 text-xs"
                                          value={e.label}
                                          onChange={(x) =>
                                            setEdit({ ...edit, [v.id]: { ...e, label: x.target.value } })
                                          }
                                        />
                                      ) : (
                                        <span className="font-semibold text-slate-900">{v.label}</span>
                                      )}
                                    </td>

                                    <td className="num">
                                      {e ? (
                                        <input
                                          aria-label={`${v.label} — বিক্রয় দাম`}
                                          className="input w-24 py-1 text-right text-xs"
                                          type="number" step="0.01" value={e.price}
                                          autoFocus
                                          onChange={(x) =>
                                            setEdit({ ...edit, [v.id]: { ...e, price: x.target.value } })
                                          }
                                          onKeyDown={(x) => {
                                            if (x.key === 'Enter') saveVariant(v.id);
                                            if (x.key === 'Escape') cancelEdit(v.id);
                                          }}
                                        />
                                      ) : (
                                        <span className="text-base font-extrabold text-rose-600">
                                          ৳{v.price.toFixed(2)}
                                        </span>
                                      )}
                                    </td>

                                    <td className="num">
                                      {e ? (
                                        <input
                                          aria-label={`${v.label} — ক্রয় দাম`}
                                          className="input w-24 py-1 text-right text-xs"
                                          type="number" step="0.01" value={e.costPrice}
                                          onChange={(x) =>
                                            setEdit({
                                              ...edit,
                                              [v.id]: { ...e, costPrice: x.target.value },
                                            })
                                          }
                                          onKeyDown={(x) => {
                                            if (x.key === 'Enter') saveVariant(v.id);
                                            if (x.key === 'Escape') cancelEdit(v.id);
                                          }}
                                        />
                                      ) : (
                                        <span className="text-slate-500">৳{v.costPrice.toFixed(2)}</span>
                                      )}
                                    </td>

                                    <td className="num">
                                      {e ? (
                                        <input
                                          aria-label={`${v.label} — কাটা দাম`}
                                          className="input w-24 py-1 text-right text-xs"
                                          type="number" step="0.01" placeholder="—" value={e.oldPrice}
                                          onChange={(x) =>
                                            setEdit({
                                              ...edit,
                                              [v.id]: { ...e, oldPrice: x.target.value },
                                            })
                                          }
                                        />
                                      ) : (
                                        <span className="text-xs text-slate-400 line-through">
                                          {v.oldPrice ? `৳${v.oldPrice.toFixed(0)}` : '—'}
                                        </span>
                                      )}
                                    </td>

                                    <td className="whitespace-nowrap num">
                                      <span
                                        className={`font-bold ${
                                          profit >= 0 ? 'text-emerald-600' : 'text-red-600'
                                        }`}
                                      >
                                        ৳{profit.toFixed(2)}
                                      </span>
                                      <span className="ml-1 text-xs text-slate-400">({margin}%)</span>
                                    </td>

                                    <td className="num">
                                      {e ? (
                                        <input
                                          aria-label={`${v.label} — স্টক`}
                                          className="input w-20 py-1 text-right text-xs"
                                          type="number" value={e.stock}
                                          onChange={(x) =>
                                            setEdit({ ...edit, [v.id]: { ...e, stock: x.target.value } })
                                          }
                                        />
                                      ) : (
                                        <span className="text-slate-600">
                                          {v.stock < 0 ? '∞' : v.stock}
                                        </span>
                                      )}
                                    </td>

                                    <td>
                                      <div className="flex gap-1">
                                        <button
                                          disabled={busy === v.id}
                                          onClick={() =>
                                            api(
                                              '/api/admin/variant',
                                              'PATCH',
                                              { id: v.id, isActive: !v.isActive },
                                              v.isActive ? 'প্যাকেজ লুকানো' : 'প্যাকেজ দেখাচ্ছে',
                                              v.id
                                            )
                                          }
                                          title={v.isActive ? 'দেখাচ্ছে' : 'লুকানো'}
                                          className={`badge ${
                                            v.isActive
                                              ? 'bg-emerald-100 text-emerald-700'
                                              : 'bg-slate-100 text-slate-400'
                                          }`}
                                        >
                                          {v.isActive ? '👁' : '🚫'}
                                        </button>
                                        <button
                                          disabled={busy === v.id}
                                          onClick={() =>
                                            api(
                                              '/api/admin/variant',
                                              'PATCH',
                                              { id: v.id, isPopular: !v.isPopular },
                                              v.isPopular ? 'ট্যাগ সরানো' : 'জনপ্রিয় ট্যাগ যোগ',
                                              v.id
                                            )
                                          }
                                          title="জনপ্রিয় ট্যাগ"
                                          className={`badge ${
                                            v.isPopular
                                              ? 'bg-amber-100 text-amber-700'
                                              : 'bg-slate-100 text-slate-300'
                                          }`}
                                        >
                                          ★
                                        </button>
                                      </div>
                                    </td>

                                    <td className="num">
                                      {e ? (
                                        <div className="tbl-actions">
                                          <button
                                            disabled={busy === v.id}
                                            onClick={() => saveVariant(v.id)}
                                            className="btn-success px-3 py-1 text-xs"
                                          >
                                            ✓ সেভ
                                          </button>
                                          <button
                                            onClick={() => cancelEdit(v.id)}
                                            className="btn-ghost px-2.5 py-1 text-xs"
                                          >
                                            ✕
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="tbl-actions">
                                          <button
                                            onClick={() => startEdit(v)}
                                            className="btn-ghost px-3 py-1 text-xs"
                                          >
                                            ✎ এডিট
                                          </button>
                                          <button
                                            onClick={() => setDelVar({ v, p })}
                                            title="প্যাকেজ মুছুন"
                                            className="btn-danger px-2 py-1 text-xs"
                                          >
                                            🗑
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div className="border-t border-slate-100 px-4 py-3">
                        <button
                          onClick={() => {
                            setNewVar(BLANK_VARIANT);
                            setAddVar(p);
                          }}
                          className="text-sm font-bold text-rose-600 transition hover:text-rose-700"
                        >
                          + নতুন প্যাকেজ যোগ করুন
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {c.products.length === 0 && (
              <p className="card py-10 text-center text-sm text-slate-400">
                এই ক্যাটাগরিতে কোনো প্রোডাক্ট নেই
              </p>
            )}
          </div>
        </section>
      ))}

      {/* ═══ ডায়ালগ ═══ */}

      {/* ছবি */}
      <ConfirmDialog
        open={Boolean(imgFor)}
        title={`${imgFor?.name ?? ''} — ছবি`}
        confirmLabel="হয়ে গেছে"
        cancelLabel="বন্ধ"
        onConfirm={() => setImgFor(null)}
        onCancel={() => setImgFor(null)}
      >
        {imgFor && (
          <ImageUploader
            value={imgFor.image}
            folder="products"
            label=""
            aspect="aspect-square"
            cropAspect={1}
            hint="ছবি টেনে আনুন → অবস্থান ঠিক করুন → সংরক্ষণ করুন"
            onChange={async (url) => {
              setImgFor({ ...imgFor, image: url });
              await api(
                '/api/admin/product',
                'PATCH',
                { id: imgFor.id, image: url },
                url ? 'ছবি সেভ হয়েছে' : 'ছবি সরানো হয়েছে',
                imgFor.id
              );
            }}
          />
        )}
        {imgFor && (
          <button type="button" onClick={() => setPickTarget('edit')} className="btn-ghost mt-2 w-full text-xs">
            📚 লাইব্রেরি থেকে বেছে নিন
          </button>
        )}
      </ConfirmDialog>

      <MediaPicker
        open={pickTarget !== null}
        defaultFolder="products"
        onClose={() => setPickTarget(null)}
        onPick={async (m) => {
          if (pickTarget === 'new') {
            setNewProd((prev) => ({ ...prev, image: m.url }));
          } else if (imgFor) {
            setImgFor({ ...imgFor, image: m.url });
            await api('/api/admin/product', 'PATCH', { id: imgFor.id, image: m.url }, 'ছবি সেভ হয়েছে', imgFor.id);
          }
        }}
      />

      {/* প্রোডাক্ট এডিট */}
      <ConfirmDialog
        open={Boolean(editProd)}
        title="প্রোডাক্ট এডিট"
        confirmLabel="সেভ করুন"
        onConfirm={saveProduct}
        onCancel={() => setEditProd(null)}
      >
        {editProd && (
          <div className="space-y-3">
            <div>
              <label className="label">নাম</label>
              <input aria-label="নাম"
                className="input"
                value={editProd.name}
                onChange={(e) => setEditProd({ ...editProd, name: e.target.value })}
              />
            </div>
            <div>
              <label className="label">ছোট বর্ণনা</label>
              <input aria-label="ছোট বর্ণনা"
                className="input"
                value={editProd.description ?? ''}
                onChange={(e) => setEditProd({ ...editProd, description: e.target.value })}
              />
            </div>
            <div>
              <label className="label">কী চাইবে (UID লেবেল)</label>
              <input aria-label="কী চাইবে (UID লেবেল)"
                className="input"
                value={editProd.uidLabel}
                onChange={(e) => setEditProd({ ...editProd, uidLabel: e.target.value })}
              />
            </div>
            <div>
              <label className="label">কাস্টমারকে সাহায্য</label>
              <input aria-label="কাস্টমারকে সাহায্য"
                className="input"
                value={editProd.uidHint ?? ''}
                onChange={(e) => setEditProd({ ...editProd, uidHint: e.target.value })}
              />
            </div>
            <div>
              <label className="label">ডেলিভারির ধরন</label>
              <select aria-label="ডেলিভারির ধরন" className="input"
                value={editProd.deliveryType ?? 'TOPUP'}
                onChange={(e) => setEditProd({ ...editProd, deliveryType: e.target.value })}>
                <option value="TOPUP">টপ-আপ (গেম আইডিতে পাঠানো)</option>
                <option value="CODE">কোড (স্টক থেকে অটো-ডেলিভারি)</option>
              </select>
              {editProd.deliveryType === 'CODE' && (
                <p className="mt-1 text-xs" style={{ color: 'var(--v-mut)' }}>
                  কোড যোগ করুন: অ্যাডমিন → কোড স্টক। স্টকে কোড থাকলে অর্ডার হওয়ামাত্র গ্রাহক কোড পাবেন।
                </p>
              )}
            </div>
          </div>
        )}
      </ConfirmDialog>

      {/* নতুন প্যাকেজ */}
      <ConfirmDialog
        open={Boolean(addVar)}
        title={`${addVar?.name ?? ''} — নতুন প্যাকেজ`}
        confirmLabel="যোগ করুন"
        onConfirm={createVariant}
        onCancel={() => {
          setAddVar(null);
          setNewVar(BLANK_VARIANT);
        }}
      >
        <div className="space-y-3">
          <div>
            <label className="label">প্যাকেজের নাম</label>
            <input aria-label="প্যাকেজের নাম"
              className="input"
              value={newVar.label}
              onChange={(e) => setNewVar({ ...newVar, label: e.target.value })}
              placeholder="যেমন: 100 Diamond"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">বিক্রয় দাম (৳)</label>
              <input aria-label="বিক্রয় দাম (৳)"
                className="input" type="number" step="0.01"
                value={newVar.price}
                onChange={(e) => setNewVar({ ...newVar, price: e.target.value })}
                placeholder="72"
              />
            </div>
            <div>
              <label className="label">ক্রয় দাম (৳)</label>
              <input aria-label="ক্রয় দাম (৳)"
                className="input" type="number" step="0.01"
                value={newVar.costPrice}
                onChange={(e) => setNewVar({ ...newVar, costPrice: e.target.value })}
                placeholder="61"
              />
            </div>
          </div>
          <div>
            <label className="label">স্টক (−1 = আনলিমিটেড)</label>
            <input aria-label="স্টক (−1 = আনলিমিটেড)"
              className="input" type="number"
              value={newVar.stock}
              onChange={(e) => setNewVar({ ...newVar, stock: e.target.value })}
            />
          </div>
        </div>
      </ConfirmDialog>

      {/* প্যাকেজ ডিলিট */}
      <ConfirmDialog
        open={Boolean(delVar)}
        title={`"${delVar?.v.label}" মুছে ফেলবেন?`}
        message="যদি এই প্যাকেজে অর্ডার থাকে তাহলে মুছা যাবে না — শুধু লুকানো যাবে (🚫 বোতাম)।"
        confirmLabel="হ্যাঁ, মুছুন"
        danger
        onConfirm={async () => {
          const d = delVar;
          setDelVar(null);
          if (d) {
            await api('/api/admin/variant', 'DELETE', { id: d.v.id }, 'প্যাকেজ মুছে ফেলা হয়েছে', d.v.id);
          }
        }}
        onCancel={() => setDelVar(null)}
      />

      {/* প্রোডাক্ট ডিলিট */}
      <ConfirmDialog
        open={Boolean(delProd)}
        title={`"${delProd?.name}" মুছে ফেলবেন?`}
        message={`এর ${delProd?.variants.length ?? 0} টি প্যাকেজও মুছে যাবে।\n\nযদি অর্ডার থাকে তাহলে মুছা যাবে না — শুধু লুকানো যাবে (🚫 বোতাম)।`}
        confirmLabel="হ্যাঁ, মুছুন"
        danger
        onConfirm={async () => {
          const d = delProd;
          setDelProd(null);
          if (d) {
            await api('/api/admin/product', 'DELETE', { id: d.id }, 'প্রোডাক্ট মুছে ফেলা হয়েছে', d.id);
          }
        }}
        onCancel={() => setDelProd(null)}
      />

      {/* ★ background refresh indicator */}
      {pending && (
        <div className="fixed bottom-4 right-4 z-50 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-lg">
          আপডেট হচ্ছে...
        </div>
      )}
    </div>
  );
}
