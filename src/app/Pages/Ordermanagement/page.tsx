'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import axios from 'axios'

type Role = 'admin' | 'dealer' | 'staff'
type UserSession = { role: Role; id: string; name: string; roletype?: string; viewRoute: string }
type OrderData = {
  order_id: string; order_date: string; orderDate: string; order_dealer: string
  order_amount: string; order_status: string; order_discount: string; del_status: string
  reason: string; accept_order: string; outstandingDate: string; Dealer_Name: string
  orderdata_item_quantity: string; readyquantity: string; mtstatus: string
  orderdata_datetime: string; staffid: string
}
type OrderResponse = { data: OrderData[]; total?: number; count?: number; last_page?: number }
type OrderSummaryOverride = {
  grossAmount?: number | string
  discountAmount?: number | string
  netPayableAmount?: number | string
  gross_amount?: number | string
  discount_amount?: number | string
  net_payable_amount?: number | string
  order_amount?: number | string
  order_discount?: number | string
  order_discount_amount?: number | string
  order_net_amount?: number | string
}

const BACKEND_URL    = "https://mirisoft.co.in/sas/dealerapi/api"
const ITEMS_PER_PAGE = 10
const YEAR           = new Date().getFullYear()

const ROLE_CONFIG: Record<Role, {
  label: string; pillCls: string; caption: string
  endpoint: (id: string, page: number, search: string) => string
  showDealerCol: boolean; showActions: boolean
  canDelete: (s: UserSession, row: OrderData) => boolean
  canAccept: (s: UserSession, row: OrderData) => boolean
  requireReason: boolean
}> = {
  admin: {
    label: 'Admin', pillCls: 'role-admin', caption: 'All dealer orders across the system',
    endpoint: (_id, page, search) =>
      `${BACKEND_URL}/orderpegination?page=${page}&limit=${ITEMS_PER_PAGE}&search=${search}`,
    showDealerCol: true, showActions: true,
    canDelete: (_s, row) => row.accept_order === '0' && row.del_status === '0',
    canAccept: () => false,
    requireReason: true,
  },
  dealer: {
    label: 'Dealer', pillCls: 'role-dealer', caption: 'Your order history',
    endpoint: (id, page, search) =>
      `${BACKEND_URL}/orderhispegination?page=${page}&limit=${ITEMS_PER_PAGE}&search=${search}&id=${id}`,
    showDealerCol: false, showActions: true,
    canDelete: (_s, row) => row.accept_order === '0' && row.del_status === '0',
    canAccept: () => false,
    requireReason: true,
  },
  staff: {
    label: 'Staff', pillCls: 'role-staff', caption: 'Orders assigned to you',
    endpoint: (id, page, search) =>
      `${BACKEND_URL}/staffOrderrPagination?page=${page}&limit=${ITEMS_PER_PAGE}&search=${search}&id=${id}`,
    showDealerCol: true, showActions: true,
    canDelete: () => false,
    canAccept: (s, row) => s.roletype !== '2' && row.del_status === '0',
    requireReason: false,
  },
}

function resolveSession(): UserSession | null {
  if (typeof window === 'undefined') return null
  try {
    const staffRaw = localStorage.getItem('staffData')
    if (staffRaw) {
      const p = JSON.parse(staffRaw)
      if (p?.staff_id) {
        return {
          role: p.staff_roletype === '0' ? 'admin' : 'staff',
          id: p.staff_id, name: p.staff_name || '',
          roletype: p.staff_roletype, viewRoute: '/orders',
        }
      }
    }
    const userRaw = localStorage.getItem('UserData')
    if (userRaw) {
      const p = JSON.parse(userRaw)
      if (p?.Dealer_Id) return { role: 'dealer', id: p.Dealer_Id, name: p.Dealer_Name || '', viewRoute: '/orders' }
      if (p?.staff_id)  return { role: p.staff_roletype === '0' ? 'admin' : 'staff', id: p.staff_id, name: p.staff_name || '', roletype: p.staff_roletype, viewRoute: '/orders' }
      if (localStorage.getItem('roletype') === '3' && p && Object.keys(p).length > 0)
        return { role: 'admin', id: p.id || p.admin_id || p.Admin_Id || '', name: p.name || p.email || 'Admin', roletype: '0', viewRoute: '/orders' }
    }
    const adminRaw = localStorage.getItem('AdminData') || localStorage.getItem('admin')
    if (adminRaw) {
      const p = JSON.parse(adminRaw)
      if (p && Object.keys(p).length > 0)
        return { role: 'admin', id: p.id || p.admin_id || p.Admin_Id || '', name: p.name || 'Admin', roletype: '0', viewRoute: '/orders' }
    }
  } catch (_) {}
  return null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function acceptBadge(a: string) {
  return a === '1'
    ? { cls: 'badge-accepted', label: 'Accepted', dot: '#1d4ed8' }
    : { cls: 'badge-awaiting', label: 'Awaiting',  dot: '#f59e0b' }
}

function mtStatusValue(s: string) {
  const key = (s || '').trim().toLowerCase().replace(/[\s_-]/g, '')
  if (key === 'pending') return 'Pending'
  if (key === 'inprocess') return 'InProcess'
  if (key === 'completed') return 'Completed'
  return 'NoActionTaken'
}

function mtBadge(s: string) {
  const value = mtStatusValue(s)
  if (value === 'Completed') return { value, cls: 'badge-approved',  dot: '#10b981', label: 'Completed' }
  if (value === 'InProcess') return { value, cls: 'badge-inprocess', dot: '#ef4444', label: 'In Process' }
  if (value === 'Pending') return { value, cls: 'badge-pending', dot: '#f59e0b', label: 'Pending' }
  return { value, cls: 'badge-noaction', dot: '#94a3b8', label: 'No Action Taken' }
}
function moneyValue(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/,/g, '').trim()
  if (!text) return null
  const amount = Number(text)
  return Number.isFinite(amount) ? amount : null
}
function getOrderAmounts(order: OrderData, override?: OrderSummaryOverride) {
  const row = order as any
  const gross = moneyValue(override?.grossAmount ?? override?.gross_amount ?? override?.order_amount ?? order.order_amount) ?? 0
  const net = moneyValue(
    override?.netPayableAmount ??
    override?.net_payable_amount ??
    override?.order_net_amount ??
    override?.order_discount ??
    order.order_discount
  ) ?? gross
  const discount = moneyValue(
    override?.discountAmount ??
    override?.discount_amount ??
    override?.order_discount_amount
  ) ?? Math.max(0, gross - net)
  return { gross, discount, net }
}
function highlight(text: string, query: string) {
  if (!query || !text) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    text.slice(0, idx) +
    `<mark class="hl">${text.slice(idx, idx + query.length)}</mark>` +
    text.slice(idx + query.length)
  )
}

// ─── FilterTag ────────────────────────────────────────────────────────────────
function FilterTag({ label, color, bg, onRemove }: {
  label: string; color: string; bg: string; onRemove: () => void
}) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px 3px 10px', borderRadius: 20, background: bg,
      color, fontSize: 11, fontWeight: 500,
    }}>
      {label}
      <button onClick={onRemove} style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        lineHeight: 1, display: 'flex', alignItems: 'center', color, opacity: 0.7,
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  )
}

// ─── ActionMenu ───────────────────────────────────────────────────────────────
function ActionMenu({ showDelete, showAccept, acceptOrder, onView, onAccept, onDecline, onDelete }: {
  showDelete: boolean; showAccept: boolean; acceptOrder: string
  onView: () => void; onAccept: () => void; onDecline: () => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const close = (fn: () => void) => () => { fn(); setOpen(false) }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={ref}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-label="Actions"
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 3, width: 32, height: 32, borderRadius: 8,
          border: `1px solid ${open ? '#c7d2fe' : '#e2e8f0'}`,
          background: open ? '#eef2ff' : '#f8fafc',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        {[0,1,2].map(i => (
          <span key={i} style={{ width: 3.5, height: 3.5, borderRadius: '50%', background: open ? '#6366f1' : '#94a3b8', display: 'block', transition: 'background 0.15s' }} />
        ))}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 50,
          minWidth: 176,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)',
          padding: '6px',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>

          {/* View */}
          <button
            onClick={close(onView)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '9px 12px',
              borderRadius: 8, border: 'none',
              background: 'transparent', cursor: 'pointer',
              fontSize: 12.5, fontWeight: 500, color: '#374151',
              fontFamily: 'inherit', textAlign: 'left',
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{
              width: 28, height: 28, borderRadius: 7,
              background: '#f1f5f9', border: '1px solid #e2e8f0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <span>
              <div style={{ lineHeight: 1.2 }}>View Details</div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>Open order page</div>
            </span>
          </button>

          {/* Accept */}
          {showAccept && acceptOrder === '0' && (
            <button
              onClick={close(onAccept)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '9px 12px',
                borderRadius: 8, border: 'none',
                background: 'transparent', cursor: 'pointer',
                fontSize: 12.5, fontWeight: 500, color: '#065f46',
                fontFamily: 'inherit', textAlign: 'left',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#f0fdf4')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{
                width: 28, height: 28, borderRadius: 7,
                background: '#dcfce7', border: '1px solid #bbf7d0',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <span>
                <div style={{ lineHeight: 1.2 }}>Accept Order</div>
                <div style={{ fontSize: 10.5, color: '#86efac', marginTop: 2 }}>Mark as confirmed</div>
              </span>
            </button>
          )}

          {/* Already accepted → show disabled + decline */}
          {showAccept && acceptOrder === '1' && (
            <>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 8,
                fontSize: 12.5, fontWeight: 500, color: '#6ee7b7', opacity: 0.7,
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: '#f0fdf4', border: '1px solid #bbf7d0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span>
                  <div style={{ lineHeight: 1.2, color: '#065f46' }}>Accepted</div>
                  <div style={{ fontSize: 10.5, color: '#a7f3d0', marginTop: 2 }}>Already confirmed</div>
                </span>
              </div>
              <button
                onClick={close(onDecline)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 12px',
                  borderRadius: 8, border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 500, color: '#be123c',
                  fontFamily: 'inherit', textAlign: 'left',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fff1f2')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: '#fff1f2', border: '1px solid #fecdd3',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#be123c" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </span>
                <span>
                  <div style={{ lineHeight: 1.2 }}>Decline</div>
                  <div style={{ fontSize: 10.5, color: '#fda4af', marginTop: 2 }}>Revert acceptance</div>
                </span>
              </button>
            </>
          )}

          {/* Divider + Delete */}
          {showDelete && (
            <>
              <div style={{ height: 1, background: '#f1f5f9', margin: '2px 4px' }} />
              <button
                onClick={close(onDelete)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 12px',
                  borderRadius: 8, border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 500, color: '#be123c',
                  fontFamily: 'inherit', textAlign: 'left',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fff1f2')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: '#fff1f2', border: '1px solid #fecdd3',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#be123c" strokeWidth="2" strokeLinecap="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6m5 0V4h4v2" />
                  </svg>
                </span>
                <span>
                  <div style={{ lineHeight: 1.2 }}>Delete Order</div>
                  <div style={{ fontSize: 10.5, color: '#fda4af', marginTop: 2 }}>This cannot be undone</div>
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const router      = useRouter()
  const queryClient = useQueryClient()

  const [session,      setSession     ] = useState<UserSession | null>(null)
  const [page,         setPage        ] = useState(1)
  const [toast,        setToast       ] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const [orderIdInput, setOrderIdInput] = useState('')
  const [dealerInput,  setDealerInput ] = useState('')
  const [statusSearch, setStatusSearch] = useState('')
  const [mtFilter,     setMtFilter    ] = useState('')
  const [amountMin,    setAmountMin   ] = useState('')
  const [amountMax,    setAmountMax   ] = useState('')
  const [dateFrom,     setDateFrom    ] = useState('')
  const [dateTo,       setDateTo      ] = useState('')
  const [summaryOverrides, setSummaryOverrides] = useState<Record<string, OrderSummaryOverride>>({})

  useEffect(() => {
    const s = resolveSession()
    if (!s) { router.push('/auth/login'); return }
    setSession(s)
  }, [])

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])
  useEffect(() => { setPage(1) }, [orderIdInput, dealerInput, statusSearch, mtFilter, amountMin, amountMax, dateFrom, dateTo])

  const cfg          = session ? ROLE_CONFIG[session.role] : null
  const serverSearch = dealerInput

  const { data: response, isLoading, isError } = useQuery<OrderResponse>({
    queryKey: ['orders', session?.role, session?.id, page, serverSearch],
    queryFn: async () => {
      if (!session || !cfg) throw new Error('No session')
      const res = await axios.get(cfg.endpoint(session.id, page, serverSearch))
      return res.data
    },
    enabled: !!session,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const allData: OrderData[] = response?.data || []
  const allOrderIdsKey = allData.map(o => o.order_id).filter(Boolean).join(',')

  useEffect(() => {
    if (!allOrderIdsKey) { setSummaryOverrides({}); return }
    fetch(`/api/order-summary-overrides?order_ids=${encodeURIComponent(allOrderIdsKey)}`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) return
        const next: Record<string, OrderSummaryOverride> = {}
        ;(json.data ?? []).forEach((item: any) => {
          if (item.orderId) next[item.orderId] = item
        })
        setSummaryOverrides(next)
      })
      .catch(() => {})
  }, [allOrderIdsKey])

  const filteredAll = allData.filter(o => {
    const amounts = getOrderAmounts(o, summaryOverrides[o.order_id])
    if (orderIdInput.trim() && !o.order_id.startsWith(orderIdInput.trim())) return false
    if (dealerInput.trim()  && !(o.Dealer_Name || '').toLowerCase().includes(dealerInput.trim().toLowerCase())) return false
    if (statusSearch !== '' && o.accept_order !== statusSearch) return false
    if (mtFilter     !== '' && mtStatusValue(o.mtstatus) !== mtFilter) return false
    if (amountMin    !== '' && amounts.gross < Number(amountMin)) return false
    if (amountMax    !== '' && amounts.gross > Number(amountMax)) return false
    if (dateFrom !== '') { const d = (o.orderDate || o.order_date || '').slice(0, 10); if (d < dateFrom) return false }
    if (dateTo   !== '') { const d = (o.orderDate || o.order_date || '').slice(0, 10); if (d > dateTo)   return false }
    return true
  })

  const hasClientFilters = !!(orderIdInput || dealerInput || statusSearch || mtFilter || amountMin || amountMax || dateFrom || dateTo)
  const shouldSlice      = allData.length > ITEMS_PER_PAGE && !response?.last_page

  const data: OrderData[] = hasClientFilters
    ? filteredAll.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
    : shouldSlice ? allData.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
    : allData

  const total      = hasClientFilters ? filteredAll.length : shouldSlice ? allData.length : (response?.total ?? response?.count ?? allData.length)
  const totalPages = response?.last_page ?? Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))
  const startIndex = total === 0 ? 0 : (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex   = total === 0 ? 0 : Math.min(page * ITEMS_PER_PAGE, total)

  const clearSearch     = () => { setOrderIdInput(''); setDealerInput(''); setStatusSearch('') }
  const clearAllFilters = () => { setMtFilter(''); setAmountMin(''); setAmountMax(''); setDateFrom(''); setDateTo('') }

  const exportCSV = () => {
    const rows = (hasClientFilters ? filteredAll : allData).map((o, i) => {
      const amounts = getOrderAmounts(o, summaryOverrides[o.order_id])
      const base: Record<string, string | number> = {
        'S.No.':        i + 1,
        'Order No':     `OM/${YEAR}/${o.order_id}`,
        'Date':         (o.orderDate || o.order_date || '').slice(0, 10),
        'Due Date':     o.outstandingDate || '',
        'Amount (₹)':   amounts.gross,
        'Discount (₹)': amounts.discount,
        'Net (₹)':      amounts.net,
        'Qty':          o.orderdata_item_quantity || '',
        'Confirmation': o.accept_order === '1' ? 'Accepted' : 'Awaiting',
        'MT Status':    mtBadge(o.mtstatus).label,
      }
      if (cfg?.showDealerCol) base['Dealer'] = o.Dealer_Name || ''
      return base
    })
    if (!rows.length) return

    const headers = Object.keys(rows[0])
    const csv = [
      headers.join(','),
      ...rows.map(r =>
        headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n')

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url

    const parts = ['orders']
    if (dealerInput)  parts.push(`dealer-${dealerInput.replace(/\s+/g, '-')}`)
    if (orderIdInput) parts.push(`id-${orderIdInput}`)
    if (dateFrom || dateTo) parts.push(`${dateFrom || 'start'}-to-${dateTo || 'now'}`)
    if (statusSearch) parts.push(statusSearch === '1' ? 'accepted' : 'awaiting')
    if (mtFilter)     parts.push(mtBadge(mtFilter).label.toLowerCase().replace(/\s+/g, '-'))
    if (amountMin || amountMax) parts.push(`amt-${amountMin || '0'}-${amountMax || 'max'}`)
    parts.push(new Date().toISOString().slice(0, 10))

    a.download = `${parts.join('_')}.csv`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
    setToast({ msg: `Exported ${rows.length} order${rows.length !== 1 ? 's' : ''}.`, type: 'ok' })
  }

  const handleDelete = useCallback(async (id: string) => {
    if (!session || !cfg) return
    const reason = cfg.requireReason ? window.prompt('Reason for delete') : ''
    if (cfg.requireReason && !reason?.trim()) { setToast({ msg: 'Please provide a reason.', type: 'err' }); return }
    if (!window.confirm('Are you sure?')) return
    const fd = new FormData()
    fd.append('id', id); fd.append('tbl', 'order_tbl'); fd.append('field', 'order_id')
    if (reason) fd.append('reason', reason)
    try {
      const res = await axios.post(`${BACKEND_URL}/deletewithreason`, fd)
      setToast({ msg: res.data?.msg || 'Deleted.', type: 'ok' })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    } catch { setToast({ msg: 'Delete failed.', type: 'err' }) }
  }, [session, cfg, queryClient])

  const handleAccept = useCallback(async (id: string, status: 0 | 1) => {
    const fd = new FormData()
    fd.append('id', id); fd.append('status', String(status))
    try {
      const res = await axios.post(`${BACKEND_URL}/acceptstatus_requst`, fd)
      setToast({ msg: res.data?.msg || 'Status updated.', type: 'ok' })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    } catch { setToast({ msg: 'Action failed.', type: 'err' }) }
  }, [queryClient])

  function pageNumbers(): (number | '…')[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages: (number | '…')[] = [1]
    const s = Math.max(2, page - 1); const e = Math.min(totalPages - 1, page + 1)
    if (s > 2) pages.push('…')
    for (let i = s; i <= e; i++) pages.push(i)
    if (e < totalPages - 1) pages.push('…')
    pages.push(totalPages)
    return pages
  }
  const handlePageChange = (p: number) => {
    if (p < 1 || p > totalPages) return
    setPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const inputCls = (active: boolean) =>
    `h-[30px] px-2.5 rounded-[7px] border text-[11.5px] outline-none font-[inherit] transition-colors ${
      active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-gray-50 text-gray-500'
    }`
  const selectCls = (active: boolean) =>
    `h-[30px] pl-2.5 pr-6 rounded-[7px] border text-[11.5px] outline-none font-[inherit] appearance-none cursor-pointer transition-colors ${
      active ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-gray-50 text-gray-500'
    }`

  if (!session || !cfg) return null

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .orders-root { min-height: 100vh; background: #f7f8fc; font-family: 'Sora', sans-serif; color: #0f172a; }
        .orders-topbar { background: #fff; border-bottom: 1px solid #e8eaf0; padding: 0 28px; height: 60px; display: flex; align-items: center; gap: 14px; position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 8px rgba(0,0,0,0.04); }
        .back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px 6px 10px; border-radius: 8px; border: 1px solid #e2e6ef; background: #f7f8fc; font-size: 12.5px; font-weight: 500; color: #475569; cursor: pointer; font-family: inherit; transition: all 0.15s; }
        .back-btn:hover { background: #eef0f8; border-color: #c7cde0; color: #1e293b; transform: translateX(-1px); }
        .topbar-divider { width: 1px; height: 22px; background: #e2e6ef; }
        .topbar-title { font-size: 15px; font-weight: 600; color: #0f172a; }
        .topbar-sub { font-size: 12px; color: #94a3b8; margin-left: 4px; }
        .role-pill { padding: 3px 11px; border-radius: 20px; font-size: 11px; font-weight: 600; }
        .role-admin  { background: #ede9fe; color: #7c3aed; }
        .role-dealer { background: #dbeafe; color: #1d4ed8; }
        .role-staff  { background: #d1fae5; color: #065f46; }
        .orders-body { padding: 24px 28px; max-width: 1440px; margin: 0 auto; }
        mark.hl { background: #fef08a; color: #713f12; border-radius: 2px; padding: 0 1px; }
        .stats-row { display: flex; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
        .stat-pill { display: flex; align-items: center; gap: 7px; padding: 7px 14px; background: #fff; border: 1px solid #e8eaf0; border-radius: 10px; font-size: 12px; color: #374151; font-weight: 500; }
        .stat-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .stat-num { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 12.5px; color: #0f172a; }
        .table-card { background: #fff; border: 1px solid #e8eaf0; border-radius: 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.04); overflow: visible; }
        .table-scroll { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        thead { background: #f8f9fd; }
        th { padding: 10px 14px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #64748b; border-bottom: 1px solid #e8eaf0; white-space: nowrap; vertical-align: top; }
        th:first-child { padding-left: 20px; } th:last-child { padding-right: 20px; }
        th .th-filter { margin-top: 6px; }
        tbody tr { border-bottom: 1px solid #f1f3f9; transition: background 0.12s; }
        tbody tr:last-child { border-bottom: none; } tbody tr:hover { background: #f8f9fd; }
        td { padding: 12px 14px; vertical-align: middle; color: #374151; }
        td:first-child { padding-left: 20px; } td:last-child { padding-right: 20px; }
        .shimmer { height: 13px; border-radius: 6px; background: linear-gradient(90deg, #f0f2f8 25%, #e4e8f2 50%, #f0f2f8 75%); background-size: 200% 100%; animation: sh 1.4s infinite; }
        @keyframes sh { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .order-id-pill { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 500; background: #f1f3fb; color: #4b5563; padding: 3px 8px; border-radius: 6px; border: 1px solid #e2e6ef; }
        .amount-pill { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; font-weight: 600; color: #065f46; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
        .dealer-name { font-weight: 500; color: #1e293b; font-size: 12.5px; }
        .dealer-sub  { font-size: 10.5px; color: #94a3b8; margin-top: 1px; }
        .mono-sm     { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: #64748b; }
        .qty-info    { font-size: 10.5px; color: #94a3b8; margin-top: 2px; }
        .reason-tag  { font-size: 10.5px; color: #be123c; margin-top: 2px; }
        .badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
        .badge-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
        .badge-approved  { background: #ecfdf5; color: #065f46; }
        .badge-pending   { background: #fffbeb; color: #92400e; }
        .badge-accepted  { background: #eff6ff; color: #1d4ed8; }
        .badge-awaiting  { background: #fffbeb; color: #92400e; }
        .badge-inprocess { background: #fff1f2; color: #be123c; }
        .badge-noaction  { background: #f8fafc; color: #475569; }
        .empty-row td { padding: 52px 20px; text-align: center; color: #9ca3af; font-size: 13px; }
        .pagination { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-top: 1px solid #f1f3f9; flex-wrap: wrap; gap: 12px; }
        .pagination-info { font-size: 12px; color: #94a3b8; }
        .pagination-info strong { color: #374151; font-weight: 600; }
        .pager { display: flex; align-items: center; gap: 4px; }
        .page-btn { min-width: 32px; height: 32px; padding: 0 8px; border-radius: 8px; border: 1px solid #e2e6ef; background: #fff; font-size: 12.5px; font-family: 'Sora', sans-serif; font-weight: 500; color: #374151; cursor: pointer; transition: all 0.12s; display: flex; align-items: center; justify-content: center; gap: 4px; }
        .page-btn:hover:not(:disabled):not(.active) { background: #f1f3fb; border-color: #c7cde0; }
        .page-btn.active { background: #1e40af; border-color: #1e40af; color: #fff; font-weight: 600; }
        .page-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .page-ell { padding: 0 4px; color: #94a3b8; font-size: 13px; }
        .toast-wrap { position: fixed; bottom: 24px; right: 24px; z-index: 100; padding: 12px 20px; border-radius: 12px; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.12); animation: slideUp 0.2s ease; }
        .toast-ok  { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
        .toast-err { background: #fff1f2; color: #be123c; border: 1px solid #fecdd3; }
        @keyframes slideUp { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .active-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
      `}</style>

      <div className="orders-root">

        {/* Toast */}
        {toast && (
          <div className={`toast-wrap ${toast.type === 'ok' ? 'toast-ok' : 'toast-err'}`}>
            {toast.type === 'ok'
              ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5" /></svg>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
            }
            {toast.msg}
          </div>
        )}

        {/* Topbar */}
        <div className="orders-topbar">
          <button className="back-btn" onClick={() => router.back()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Back
          </button>
          <div className="topbar-divider" />
          <span className="topbar-title">
            Order Management
            {!isLoading && total > 0 && <span className="topbar-sub">· {total.toLocaleString()} records</span>}
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className={`role-pill ${cfg.pillCls}`}>{cfg.label} View</span>
            <span className="text-xs text-gray-400 font-mono">id: {session.id || 'none'}</span>
          </div>
        </div>

        <div className="orders-body">

          {/* Heading */}
          <div className="flex items-end justify-between flex-wrap gap-4 mb-5">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
              <p className="text-sm text-slate-500 mt-1">{cfg.caption}</p>
            </div>
            <button
              onClick={exportCSV}
              disabled={isLoading || allData.length === 0}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 16px', borderRadius: 10,
                border: `1px solid ${hasClientFilters ? '#a5b4fc' : '#e2e6ef'}`,
                background: hasClientFilters ? '#eef2ff' : '#fff',
                color: hasClientFilters ? '#4338ca' : '#374151',
                fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.15s',
                opacity: (isLoading || allData.length === 0) ? 0.4 : 1,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
              <span style={{
                padding: '1px 7px', borderRadius: 20,
                background: hasClientFilters ? '#c7d2fe' : '#f1f3fb',
                color: hasClientFilters ? '#3730a3' : '#64748b',
                fontSize: 11, fontWeight: 700,
              }}>
                {hasClientFilters ? filteredAll.length : allData.length}
              </span>
            </button>
          </div>

          {/* Active filter tags */}
          {(orderIdInput || dealerInput || statusSearch || mtFilter || amountMin || amountMax || dateFrom || dateTo) && (
            <div className="active-tags">
              {orderIdInput  && <FilterTag label={`ID: ${orderIdInput}…`} color="#4338ca" bg="#eef2ff" onRemove={() => setOrderIdInput('')} />}
              {dealerInput   && <FilterTag label={`Dealer: ${dealerInput}`} color="#065f46" bg="#ecfdf5" onRemove={() => setDealerInput('')} />}
              {statusSearch  && <FilterTag label={statusSearch === '1' ? 'Accepted' : 'Awaiting'} color={statusSearch === '1' ? '#1d4ed8' : '#92400e'} bg={statusSearch === '1' ? '#eff6ff' : '#fffbeb'} onRemove={() => setStatusSearch('')} />}
              {mtFilter      && <FilterTag label={mtBadge(mtFilter).label} color="#92400e" bg="#fffbeb" onRemove={() => setMtFilter('')} />}
              {(amountMin || amountMax) && <FilterTag label={`₹${amountMin||'0'}–₹${amountMax||'∞'}`} color="#065f46" bg="#ecfdf5" onRemove={() => { setAmountMin(''); setAmountMax('') }} />}
              {(dateFrom || dateTo) && <FilterTag label={`${dateFrom||'…'} → ${dateTo||'…'}`} color="#7c3aed" bg="#ede9fe" onRemove={() => { setDateFrom(''); setDateTo('') }} />}
              <button onClick={() => { clearSearch(); clearAllFilters() }} className="text-[11px] text-slate-400 underline cursor-pointer bg-transparent border-none font-[inherit] px-2">
                Clear all
              </button>
            </div>
          )}

          {/* Stats */}
          {!isLoading && (
            <div className="stats-row">
              <div className="stat-pill"><span className="stat-dot" style={{ background: '#6366f1' }} />{hasClientFilters ? 'Filtered' : 'Total'}<span className="stat-num">{total.toLocaleString()}</span></div>
              <div className="stat-pill"><span className="stat-dot" style={{ background: '#1d4ed8' }} />Accepted<span className="stat-num">{data.filter(o => o.accept_order === '1').length}</span></div>
              <div className="stat-pill"><span className="stat-dot" style={{ background: '#f59e0b' }} />Awaiting<span className="stat-num">{data.filter(o => o.accept_order === '0').length}</span></div>
              <div className="stat-pill"><span className="stat-dot" style={{ background: '#3b82f6' }} />Page<span className="stat-num">{page} / {totalPages}</span></div>
            </div>
          )}

          {isError && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
              Failed to load orders. Please try again.
            </div>
          )}

          {/* Table */}
          <div className="table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>
                      Order ID
                      <div className="th-filter">
                        <input type="text" placeholder="e.g. 45…" value={orderIdInput} onChange={e => setOrderIdInput(e.target.value)} maxLength={8} autoComplete="off" className={`w-[90px] ${inputCls(!!orderIdInput)}`} />
                      </div>
                    </th>
                    {cfg.showDealerCol && (
                      <th>
                        Dealer
                        <div className="th-filter">
                          <input type="text" placeholder="Search…" value={dealerInput} onChange={e => setDealerInput(e.target.value)} autoComplete="off" className={`w-[120px] ${inputCls(!!dealerInput)}`} />
                        </div>
                      </th>
                    )}
                    <th>
                      Order Date
                      <div className="th-filter">
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls(!!dateFrom)} style={{ width: 130 }} />
                      </div>
                    </th>
                    <th>Due Date</th>
                    <th>
                      Amount
                      <div className="th-filter flex gap-1">
                        <input type="number" placeholder="Min" value={amountMin} onChange={e => setAmountMin(e.target.value)} className={`w-[60px] ${inputCls(!!amountMin)}`} />
                        <input type="number" placeholder="Max" value={amountMax} onChange={e => setAmountMax(e.target.value)} className={`w-[60px] ${inputCls(!!amountMax)}`} />
                      </div>
                    </th>
                    <th>Discount</th>
                    <th>After Discount</th>
                    <th>Qty</th>
                    <th>
                      Confirmation
                      <div className="th-filter relative">
                        <select value={statusSearch} onChange={e => setStatusSearch(e.target.value)} className={`w-[110px] ${selectCls(!!statusSearch)}`}>
                          <option value="">Any</option>
                          <option value="1">Accepted</option>
                          <option value="0">Awaiting</option>
                        </select>
                      </div>
                    </th>
                    <th>
                      MT Status
                      <div className="th-filter relative">
                        <select value={mtFilter} onChange={e => setMtFilter(e.target.value)} className={`w-[145px] ${selectCls(!!mtFilter)}`}>
                          <option value="">Any</option>
                          <option value="Pending">Pending</option>
                          <option value="InProcess">In Process</option>
                          <option value="Completed">Completed</option>
                          <option value="NoActionTaken">No Action Taken</option>
                        </select>
                      </div>
                    </th>
                    {cfg.showActions && <th>Actions</th>}
                  </tr>
                </thead>

                <tbody>
                  {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: cfg.showDealerCol ? 12 : 11 }).map((_, j) => (
                        <td key={j}><div className="shimmer" style={{ width: j === 2 ? 120 : 70 }} /></td>
                      ))}
                    </tr>
                  ))}

                  {!isLoading && data.length === 0 && (
                    <tr className="empty-row">
                      <td colSpan={cfg.showDealerCol ? 12 : 11}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="1.5" style={{ margin: '0 auto 10px', display: 'block' }}>
                          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
                        </svg>
                        {hasClientFilters ? 'No orders match the current filters' : 'No orders found'}
                      </td>
                    </tr>
                  )}

                  {!isLoading && data.map((order, i) => {
                    const ab         = acceptBadge(order.accept_order)
                    const mtb        = mtBadge(order.mtstatus)
                    const showDelete = cfg.canDelete(session, order)
                    const showAccept = cfg.canAccept(session, order)
                    const hlId       = orderIdInput ? highlight(order.order_id ?? '', orderIdInput) : (order.order_id ?? '')
                    const hlDealer   = dealerInput  ? highlight(order.Dealer_Name || '—', dealerInput) : (order.Dealer_Name || '—')
                    const amounts    = getOrderAmounts(order, summaryOverrides[order.order_id])

                    return (
                      <tr key={order.order_id ?? i}>
                        <td className="mono-sm">{startIndex + i}</td>

                        <td>
                          <span className="order-id-pill" dangerouslySetInnerHTML={{ __html: `OM/${YEAR}/${hlId}` }} />
                        </td>

                        {cfg.showDealerCol && (
                          <td>
                            <div className="dealer-name" dangerouslySetInnerHTML={{ __html: hlDealer }} />
                            <div className="dealer-sub">ID: {order.order_dealer}</div>
                          </td>
                        )}

                        <td className="mono-sm">{(order.orderDate || order.order_date || '—').slice(0, 10)}</td>
                        <td className="mono-sm">{order.outstandingDate || '—'}</td>

                        <td><span className="amount-pill">₹{amounts.gross.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></td>
                        <td className="mono-sm">₹{amounts.discount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                        <td className="mono-sm">₹{amounts.net.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>

                        <td style={{ textAlign: 'center', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, color: '#374151' }}>
                          {order.orderdata_item_quantity || '—'}
                        </td>

                        <td>
                          <span className={`badge ${ab.cls}`}>
                            <span className="badge-dot" style={{ background: ab.dot }} />
                            {ab.label}
                          </span>
                        </td>

                        <td>
                          <span className={`badge ${mtb.cls}`}>
                            <span className="badge-dot" style={{ background: mtb.dot }} />
                            {mtb.label}
                          </span>
                          <div className="qty-info">Total: {order.orderdata_item_quantity} · Dispatch: {order.readyquantity}</div>
                          {order.reason && <div className="reason-tag">⚠ {order.reason}</div>}
                        </td>

                        {cfg.showActions && (
                          <td>
                            <ActionMenu
                              showDelete={showDelete}
                              showAccept={showAccept}
                              acceptOrder={order.accept_order}
                              // ── unified route: same detail page as order history ──
                              onView={() => router.push(`/orders/${order.order_id}`)}
                              onAccept={() => handleAccept(order.order_id, 1)}
                              onDecline={() => handleAccept(order.order_id, 0)}
                              onDelete={() => handleDelete(order.order_id)}
                            />
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="pagination">
              <div className="pagination-info">
                {data.length > 0
                  ? <><strong>{startIndex}–{endIndex}</strong> of <strong>{total.toLocaleString()}</strong> orders</>
                  : 'No results'}
              </div>
              <div className="pager">
                <button className="page-btn" onClick={() => handlePageChange(page - 1)} disabled={page === 1}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
                  Prev
                </button>
                {pageNumbers().map((p, idx) =>
                  p === '…'
                    ? <span key={`e${idx}`} className="page-ell">…</span>
                    : <button key={p} onClick={() => handlePageChange(p as number)} className={`page-btn${p === page ? ' active' : ''}`}>{p}</button>
                )}
                <button className="page-btn" onClick={() => handlePageChange(page + 1)} disabled={page === totalPages}>
                  Next
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
