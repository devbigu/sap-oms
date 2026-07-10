'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { Package, ArrowLeft, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api"

type ToastState = { text: string; ok: boolean } | null

export default function AddProductPage() {
  const router = useRouter()

  const [loading,     setLoading]     = useState(false)
  const [toast,       setToast]       = useState<ToastState>(null)

  const [name,        setName]        = useState("")
  const [price,       setPrice]       = useState("")
  const [discription, setDiscription] = useState("")
  const [unit,        setUnit]        = useState("")
  const [cat,         setCat]         = useState("")
  const [quantity,    setQuantity]    = useState("")

  const showToast = (text: string, ok: boolean) => {
    setToast({ text, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const resetForm = () => {
    setName(""); setPrice(""); setDiscription("")
    setUnit(""); setCat(""); setQuantity("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !price.trim()) {
      showToast("Product name and price are required.", false)
      return
    }
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append("product_name",        name)
      fd.append("product_discription", discription)
      fd.append("product_unit",        unit)
      fd.append("product_quantity",    quantity)
      fd.append("product_cat",         cat)
      fd.append("product_price",       price)

      const res = await axios.post(`${BACKEND_URL}/addproduct`, fd)
      showToast(res.data?.msg || "Product added successfully!", true)
      resetForm()
    } catch {
      showToast("Failed to add product. Please try again.", false)
    } finally {
      setLoading(false)
    }
  }

  const fields = [
    { label: "Product Name",      placeholder: "e.g. Bio Scientific Kit",   value: name,        setter: setName,        type: "text",   required: true,  col: 2 },
    { label: "Price (₹)",         placeholder: "e.g. 1200",                  value: price,       setter: setPrice,       type: "number", required: true,  col: 1 },
    { label: "Quantity",          placeholder: "e.g. 50",                    value: quantity,    setter: setQuantity,    type: "number", required: false, col: 1 },
    { label: "Unit",              placeholder: "e.g. pcs, box, ml",         value: unit,        setter: setUnit,        type: "text",   required: false, col: 1 },
    { label: "Catalogue Number",  placeholder: "e.g. CAT-00142",            value: cat,         setter: setCat,         type: "text",   required: false, col: 1 },
    { label: "Description",       placeholder: "Brief product description…", value: discription, setter: setDiscription, type: "text",   required: false, col: 2 },
  ]

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ap-root {
          min-height: 100vh;
          background: #f4f5f9;
          font-family: 'Outfit', sans-serif;
          color: #0f172a;
        }

        /* ── Topbar ── */
        .ap-topbar {
          background: linear-gradient(135deg, #0f1729 0%, #1a2744 100%);
          height: 64px; padding: 0 32px;
          display: flex; align-items: center; gap: 14px;
          position: sticky; top: 0; z-index: 20;
          box-shadow: 0 2px 16px rgba(0,0,0,0.18);
        }
        .back-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 13px 6px 9px; border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(255,255,255,0.06);
          font-size: 12.5px; font-weight: 500; color: rgba(255,255,255,0.72);
          cursor: pointer; font-family: inherit; transition: all 0.15s;
        }
        .back-btn:hover { background: rgba(255,255,255,0.12); color: #fff; transform: translateX(-1px); }
        .ap-topbar-div { width: 1px; height: 22px; background: rgba(255,255,255,0.12); }
        .ap-topbar-title { font-size: 15px; font-weight: 600; color: #fff; }
        .ap-topbar-sub   { font-size: 11.5px; color: rgba(255,255,255,0.42); margin-top: 1px; }

        /* ── Body ── */
        .ap-body { padding: 32px; max-width: 900px; margin: 0 auto; }

        /* ── Page header ── */
        .ap-page-header { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; }
        .ap-icon-wrap {
          width: 52px; height: 52px; border-radius: 14px;
          background: linear-gradient(135deg, #1e3a8a, #3b5bdb);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 14px rgba(59,91,219,0.3); flex-shrink: 0;
        }
        .ap-page-title   { font-size: 24px; font-weight: 700; letter-spacing: -0.03em; color: #0f172a; }
        .ap-page-caption { font-size: 13px; color: #64748b; margin-top: 3px; }

        /* ── Form card ── */
        .form-card {
          background: #fff;
          border: 1px solid #e8edf5;
          border-radius: 20px;
          box-shadow: 0 2px 16px rgba(0,0,0,0.05);
          overflow: hidden;
        }
        .form-card-header {
          padding: 20px 28px;
          border-bottom: 1px solid #f1f5fb;
          background: #f8faff;
          display: flex; align-items: center; justify-content: space-between;
        }
        .form-card-title { font-size: 13px; font-weight: 600; color: #334155; text-transform: uppercase; letter-spacing: 0.07em; }
        .required-note { font-size: 11.5px; color: #94a3b8; }
        .required-note span { color: #ef4444; }

        .form-body { padding: 28px; }

        /* ── Grid ── */
        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px 24px;
        }
        .col-2 { grid-column: span 2; }
        @media (max-width: 640px) {
          .form-grid { grid-template-columns: 1fr; }
          .col-2 { grid-column: span 1; }
        }

        /* ── Field ── */
        .field { display: flex; flex-direction: column; gap: 7px; }
        .field-label {
          font-size: 12.5px; font-weight: 600; color: #374151;
          display: flex; align-items: center; gap: 4px;
        }
        .field-label .req { color: #ef4444; font-size: 13px; }

        .field-input {
          padding: 10px 14px;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          font-size: 13.5px;
          font-family: 'Outfit', sans-serif;
          color: #0f172a;
          background: #fff;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
          width: 100%;
        }
        .field-input::placeholder { color: #94a3b8; font-size: 13px; }
        .field-input:focus {
          border-color: #3b5bdb;
          box-shadow: 0 0 0 3px rgba(59,91,219,0.1);
          background: #fafbff;
        }
        .field-input:hover:not(:focus) { border-color: #cbd5e1; }

        /* number input — remove arrows */
        .field-input[type="number"]::-webkit-inner-spin-button,
        .field-input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; }
        .field-input[type="number"] { -moz-appearance: textfield; font-family: 'JetBrains Mono', monospace; }

        /* ── Divider ── */
        .form-divider { border: none; border-top: 1px solid #f1f5fb; margin: 24px 0; }

        /* ── Actions ── */
        .form-actions { display: flex; align-items: center; gap: 12px; justify-content: flex-end; }
        .btn-reset {
          padding: 10px 20px; border-radius: 10px;
          border: 1.5px solid #e2e8f0; background: #fff;
          font-size: 13.5px; font-weight: 500; color: #374151;
          cursor: pointer; font-family: inherit; transition: all 0.14s;
        }
        .btn-reset:hover { background: #f8fafc; border-color: #cbd5e1; }
        .btn-reset:disabled { opacity: 0.4; cursor: not-allowed; }

        .btn-submit {
          padding: 10px 28px; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #1e3a8a, #3b5bdb);
          font-size: 13.5px; font-weight: 600; color: #fff;
          cursor: pointer; font-family: inherit; transition: all 0.15s;
          display: inline-flex; align-items: center; gap: 8px;
          box-shadow: 0 3px 10px rgba(59,91,219,0.3);
        }
        .btn-submit:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 5px 16px rgba(59,91,219,0.36); }
        .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        /* ── Toast ── */
        .toast {
          position: fixed; bottom: 24px; right: 24px; z-index: 100;
          padding: 13px 18px; border-radius: 12px;
          font-size: 13px; font-weight: 500;
          display: flex; align-items: center; gap: 9px;
          box-shadow: 0 6px 24px rgba(0,0,0,0.13);
          animation: toastIn 0.22s ease;
          max-width: 340px;
        }
        .toast-ok  { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
        .toast-err { background: #fff1f2; color: #be123c; border: 1px solid #fecdd3; }
        @keyframes toastIn { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

        /* ── Preview strip (filled fields) ── */
        .preview-strip {
          margin-top: 24px; padding: 16px 20px;
          background: #f8faff; border: 1px solid #e8edf5; border-radius: 12px;
          display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
        }
        .preview-label { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.07em; margin-right: 4px; }
        .preview-chip {
          padding: 3px 10px; border-radius: 20px;
          font-size: 12px; font-weight: 500;
          background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe;
        }
        .preview-chip.price { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; font-family: 'JetBrains Mono', monospace; }
        .preview-chip.cat   { background: #f1f5fb; color: #334155; border-color: #e2e8f0; font-family: 'JetBrains Mono', monospace; }
      `}</style>

      <div className="ap-root">

        {/* Toast */}
        {toast && (
          <div className={`toast ${toast.ok ? "toast-ok" : "toast-err"}`}>
            {toast.ok
              ? <CheckCircle size={15} />
              : <AlertCircle size={15} />
            }
            {toast.text}
          </div>
        )}

        {/* ── Topbar ── */}
        <div className="ap-topbar">
          <button className="back-btn" onClick={() => router.back()}>
            <ArrowLeft size={13} />
            Back
          </button>
          <div className="ap-topbar-div" />
          <div>
            <div className="ap-topbar-title">Product Catalogue</div>
            <div className="ap-topbar-sub">Add a new product to the system</div>
          </div>
        </div>

        <div className="ap-body">

          {/* ── Page header ── */}
          <div className="ap-page-header">
            <div className="ap-icon-wrap">
              <Package size={24} color="#fff" />
            </div>
            <div>
              <div className="ap-page-title">Add Product</div>
              <div className="ap-page-caption">Fill in the details below to add a new product</div>
            </div>
          </div>

          {/* ── Form card ── */}
          <div className="form-card">
            <div className="form-card-header">
              <span className="form-card-title">Product Details</span>
              <span className="required-note"><span>*</span> Required fields</span>
            </div>

            <div className="form-body">
              <form onSubmit={handleSubmit}>
                <div className="form-grid">
                  {fields.map(field => (
                    <div
                      key={field.label}
                      className={`field${field.col === 2 ? " col-2" : ""}`}
                    >
                      <label className="field-label">
                        {field.label}
                        {field.required && <span className="req">*</span>}
                      </label>
                      <input
                        type={field.type}
                        className="field-input"
                        placeholder={field.placeholder}
                        value={field.value}
                        onChange={e => field.setter(e.target.value)}
                        disabled={loading}
                        min={field.type === "number" ? "0" : undefined}
                      />
                    </div>
                  ))}
                </div>

                {/* Live preview strip */}
                {(name || price || cat || unit) && (
                  <div className="preview-strip">
                    <span className="preview-label">Preview</span>
                    {name  && <span className="preview-chip">{name}</span>}
                    {price && <span className="preview-chip price">₹{Number(price).toLocaleString("en-IN")}</span>}
                    {cat   && <span className="preview-chip cat">{cat}</span>}
                    {unit  && <span className="preview-chip">{unit}</span>}
                    {quantity && <span className="preview-chip">Qty: {quantity}</span>}
                  </div>
                )}

                <hr className="form-divider" />

                <div className="form-actions">
                  <button
                    type="button"
                    className="btn-reset"
                    onClick={resetForm}
                    disabled={loading}
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    className="btn-submit"
                    disabled={loading}
                  >
                    {loading
                      ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Saving…</>
                      : <><Package size={14} /> Add Product</>
                    }
                  </button>
                </div>

              </form>
            </div>
          </div>

        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  )
}
