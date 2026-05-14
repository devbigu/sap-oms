"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HotItem = {
  id: string;
  SKU: string;
  name: string;
  image: string;
  badge: string;
  active: boolean;
};

// ─── Storage helpers (shared with page.tsx) ───────────────────────────────────

const HOT_ITEMS_KEY = "hotItems";

const DEFAULT_ITEMS: HotItem[] = [
  { id: "1", SKU: "163",  name: "Adapters Reduction",          image: "", badge: "🔥 Bestseller",  active: true  },
  { id: "2", SKU: "164",  name: "Adapters Cone and Cone",      image: "", badge: "⚡ Fast moving", active: true  },
  { id: "3", SKU: "165",  name: "Adapters Socket and Socket",  image: "", badge: "🔥 Trending",   active: true  },
  { id: "4", SKU: "144",  name: "Flask Erlenmeyer Amber",      image: "", badge: "⚡ Popular",    active: true  },
  { id: "5", SKU: "145",  name: "Flask Erlenmeyer Narrow",     image: "", badge: "🔥 Top rated",  active: true  },
  { id: "6", SKU: "147",  name: "Flask Iodine",                image: "", badge: "⚡ Hot pick",   active: false },
];

export function getHotItems(): HotItem[] {
  try {
    const raw = localStorage.getItem(HOT_ITEMS_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_ITEMS;
  } catch {
    return DEFAULT_ITEMS;
  }
}

function saveHotItems(items: HotItem[]) {
  try {
    localStorage.setItem(HOT_ITEMS_KEY, JSON.stringify(items));
    window.dispatchEvent(new Event("hotItemsUpdated"));
  } catch { /* ignore */ }
}

// ─── Badge presets ────────────────────────────────────────────────────────────

const BADGE_PRESETS = [
  "🔥 Bestseller", "🔥 Trending", "🔥 Top rated",
  "⚡ Fast moving", "⚡ Popular", "⚡ Hot pick",
  "⭐ Staff pick", "🆕 New arrival", "💰 Best value",
];

// ─── Unique ID ────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

// ─── Empty form ───────────────────────────────────────────────────────────────

const emptyForm = (): Omit<HotItem, "id"> => ({
  SKU: "", name: "", image: "", badge: BADGE_PRESETS[0], active: true,
});

// ─── Toast ────────────────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const show = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };
  return { toast, show };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminHotItemsPage() {
  const router = useRouter();
  const { toast, show } = useToast();

  const [items, setItems] = useState<HotItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  // Load from localStorage
  useEffect(() => { setItems(getHotItems()); }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const openAdd = () => {
    setEditId(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (item: HotItem) => {
    setEditId(item.id);
    setForm({ SKU: item.SKU, name: item.name, image: item.image, badge: item.badge, active: item.active });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditId(null); setForm(emptyForm()); };

  const submitForm = () => {
    if (!form.SKU.trim() || !form.name.trim()) { show("SKU and name are required.", "error"); return; }

    let next: HotItem[];
    if (editId) {
      next = items.map(i => i.id === editId ? { ...i, ...form } : i);
      show("Item updated.");
    } else {
      next = [...items, { id: uid(), ...form }];
      show("Item added.");
    }
    setItems(next);
    closeForm();
  };

  const toggleActive = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, active: !i.active } : i));
  };

  const confirmDelete = () => {
    if (!deleteId) return;
    setItems(prev => prev.filter(i => i.id !== deleteId));
    setDeleteId(null);
    show("Item removed.");
  };

  const persist = () => {
    saveHotItems(items);
    setSaved(true);
    show("Changes published to homepage.");
    setTimeout(() => setSaved(false), 2000);
  };

  // ── Drag-to-reorder ────────────────────────────────────────────────────────

  const onDragStart = (idx: number) => setDragIdx(idx);
  const onDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setOverIdx(idx); };
  const onDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const next = [...items];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(idx, 0, moved);
    setItems(next);
    setDragIdx(null);
    setOverIdx(null);
  };

  const activeCount = items.filter(i => i.active).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes fadeIn  { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        @keyframes slideIn { from { opacity:0; transform:translateY(16px) scale(.97) } to { opacity:1; transform:translateY(0) scale(1) } }
        @keyframes toastIn { from { opacity:0; transform:translateX(20px) } to { opacity:1; transform:translateX(0) } }
        .card-row { animation: fadeIn .2s ease both; }
        .modal-box { animation: slideIn .22s ease both; }
        .toast-pop { animation: toastIn .22s ease both; }
        .drag-over { outline: 2px dashed #6366f1; outline-offset: 2px; background: #eef2ff; }
        .drag-ghost { opacity: .35; }
      `}</style>

      {/* ── Toast ── */}
      {toast && (
        <div className={`toast-pop fixed top-5 right-5 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-semibold border ${
          toast.type === "success"
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-red-50 border-red-200 text-red-700"
        }`}>
          {toast.type === "success"
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
          }
          {toast.msg}
        </div>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: "blur(8px)", background: "rgba(15,23,42,.45)" }}
          onClick={e => { if (e.target === e.currentTarget) setDeleteId(null); }}>
          <div className="modal-box bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="w-10 h-10 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-4">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6m5 0V4h4v2" />
              </svg>
            </div>
            <h3 className="text-[15px] font-bold text-gray-900 mb-1">Remove this item?</h3>
            <p className="text-[13px] text-gray-500 mb-5">It will be removed from the Hot Right Now section on the homepage.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteId(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={confirmDelete}
                className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-[13px] font-semibold transition-colors">
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backdropFilter: "blur(8px)", background: "rgba(15,23,42,.45)" }}
          onClick={e => { if (e.target === e.currentTarget) closeForm(); }}>
          <div className="modal-box bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-gray-900">
                {editId ? "Edit Hot Item" : "Add Hot Item"}
              </h3>
              <button onClick={closeForm} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 flex flex-col gap-4">
              {/* SKU */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">
                  SKU <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.SKU}
                  onChange={e => setForm(f => ({ ...f, SKU: e.target.value }))}
                  placeholder="e.g. PYC-25-A"
                  className="w-full px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all font-mono"
                />
              </div>

              {/* Name */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">
                  Product name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Pycnometer Class A 25ml"
                  className="w-full px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>

              {/* Image URL */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Image URL</label>
                <input
                  value={form.image}
                  onChange={e => setForm(f => ({ ...f, image: e.target.value }))}
                  placeholder="https://…"
                  className="w-full px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
                {form.image && (
                  <img src={form.image} alt="preview"
                    className="mt-2 h-16 w-16 object-contain rounded-lg border border-gray-100 bg-gray-50" />
                )}
              </div>

              {/* Badge */}
              <div>
                <label className="text-[11px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Badge</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {BADGE_PRESETS.map(b => (
                    <button key={b} type="button"
                      onClick={() => setForm(f => ({ ...f, badge: b }))}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                        form.badge === b
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-700"
                      }`}>
                      {b}
                    </button>
                  ))}
                </div>
                <input
                  value={form.badge}
                  onChange={e => setForm(f => ({ ...f, badge: e.target.value }))}
                  placeholder="Or type a custom badge…"
                  className="w-full px-3.5 py-2.5 text-[13px] border border-gray-200 rounded-xl outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                />
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                <div>
                  <p className="text-[13px] font-semibold text-gray-800">Show on homepage</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Toggle visibility without deleting</p>
                </div>
                <button type="button" onClick={() => setForm(f => ({ ...f, active: !f.active }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${form.active ? "bg-indigo-500" : "bg-gray-300"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.active ? "translate-x-5" : ""}`} />
                </button>
              </div>
            </div>

            <div className="px-6 pb-6 flex gap-2">
              <button onClick={closeForm}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={submitForm}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[13px] font-semibold transition-colors">
                {editId ? "Save changes" : "Add item"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main layout ── */}
      <div className="min-h-screen bg-[#f8fafc]" style={{ fontFamily: "'DM Sans','Helvetica Neue',sans-serif" }}>

        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 lg:px-8 py-4 sticky top-0 z-20">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button onClick={() => router.back()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-[12.5px] font-medium text-gray-600 hover:bg-gray-100 hover:-translate-x-px transition-all">
                ← Back
              </button>
              <div>
                <h1 className="text-lg font-bold text-gray-900 leading-tight">🔥 Hot Items</h1>
                <p className="text-[12px] text-gray-500">
                  {activeCount} of {items.length} active · drag rows to reorder
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={openAdd}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-[13px] font-semibold hover:bg-indigo-100 transition-colors">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add item
              </button>
              <button onClick={persist}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all ${
                  saved
                    ? "bg-emerald-500 text-white"
                    : "bg-gray-900 hover:bg-gray-700 text-white"
                }`}>
                {saved
                  ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg> Published!</>
                  : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg> Publish changes</>
                }
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 lg:px-8 py-8 flex flex-col lg:flex-row gap-8">

          {/* ── Items list ── */}
          <div className="flex-1 min-w-0">
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">

              {/* Table head */}
              <div className="grid grid-cols-[28px_56px_1fr_130px_80px_90px] items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
                {["", "", "Product", "Badge", "Status", ""].map((h, i) => (
                  <span key={i} className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{h}</span>
                ))}
              </div>

              {items.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <span className="text-4xl">🔥</span>
                  <p className="text-sm text-gray-500">No hot items yet. Add your first one.</p>
                </div>
              )}

              {items.map((item, idx) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={e => onDragOver(e, idx)}
                  onDrop={() => onDrop(idx)}
                  onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                  className={`card-row grid grid-cols-[28px_56px_1fr_130px_80px_90px] items-center gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0 transition-colors group
                    ${dragIdx === idx ? "drag-ghost" : ""}
                    ${overIdx === idx && dragIdx !== idx ? "drag-over" : "hover:bg-slate-50/60"}
                  `}
                  style={{ animationDelay: `${idx * 0.03}s` }}
                >
                  {/* Drag handle */}
                  <span className="text-gray-300 group-hover:text-gray-400 cursor-grab active:cursor-grabbing select-none text-center">
                    ⠿
                  </span>

                  {/* Image */}
                  <div className="w-12 h-12 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {item.image
                      ? <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                      : <span className="text-xl">📦</span>
                    }
                  </div>

                  {/* Name + SKU */}
                  <div className="min-w-0">
                    <p className={`text-[13px] font-semibold leading-tight truncate ${item.active ? "text-gray-900" : "text-gray-400 line-through"}`}>
                      {item.name}
                    </p>
                    <p className="text-[11px] text-gray-400 font-mono mt-0.5">{item.SKU}</p>
                  </div>

                  {/* Badge */}
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-600 border border-rose-200 w-fit truncate max-w-full">
                    {item.badge}
                  </span>

                  {/* Active toggle */}
                  <button onClick={() => toggleActive(item.id)}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${item.active ? "bg-indigo-500" : "bg-gray-200"}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${item.active ? "translate-x-5" : ""}`} />
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(item)} title="Edit"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button onClick={() => setDeleteId(item.id)} title="Remove"
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6m5 0V4h4v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Unsaved changes banner */}
            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-[12px] text-amber-700 font-medium">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
              </svg>
              Changes are local until you click <strong className="ml-1">Publish changes</strong>. This writes to localStorage and updates the homepage instantly.
            </div>
          </div>

          {/* ── Live preview ── */}
          <div className="w-full lg:w-[280px] flex-shrink-0">
            <div className="sticky top-[72px]">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Live preview</p>
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[13px] font-bold text-gray-800">Hot Right Now</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200">🔥 Trending</span>
                </div>

                {items.filter(i => i.active).length === 0 && (
                  <p className="text-[12px] text-gray-400 text-center py-6">No active items to preview.</p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {items.filter(i => i.active).slice(0, 6).map(item => (
                    <div key={item.id}
                      className="rounded-lg border border-gray-100 overflow-hidden bg-gray-50 hover:shadow-sm transition-shadow cursor-pointer">
                      <div className="relative aspect-square flex items-center justify-center p-2">
                        {item.image
                          ? <img src={item.image} alt={item.name} className="w-full h-full object-contain" />
                          : <span className="text-2xl">📦</span>
                        }
                        <span className="absolute top-1 left-1 text-[8px] font-bold px-1 py-0.5 rounded-full bg-rose-500 text-white leading-tight">
                          {item.badge}
                        </span>
                      </div>
                      <div className="px-1.5 pb-1.5">
                        <p className="text-[10px] font-medium text-gray-700 line-clamp-2 leading-tight">{item.name}</p>
                        <p className="text-[9px] text-rose-500 font-semibold mt-0.5">Shop now →</p>
                      </div>
                    </div>
                  ))}
                </div>

                {items.filter(i => i.active).length > 6 && (
                  <p className="text-[11px] text-gray-400 text-center mt-2">
                    +{items.filter(i => i.active).length - 6} more (homepage shows first 6)
                  </p>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}