'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Search, BookOpen, ChevronRight, ShieldAlert } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
type Dealer = {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_City: string
  Dealer_Email: string
  Dealer_Number: string
  status: string
  assignedstaff?: string
}

type DealerResponse = {
  data: Dealer[]
  total: number
  last_page: number
}

type StaffDealerResponse = {
  data: Dealer[]
}

type AppRole = 'admin' | 'staff' | 'accountant' | 'dealer'

// ─── Constants ────────────────────────────────────────────────────────────────
const SHIMMER = 'animate-pulse bg-gray-200 rounded'
const BACKEND_URL = 'https://mirisoft.co.in/sas/dealerapi/api'
const ITEMS_PER_PAGE = 10

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resolveRole(): { role: AppRole; dealerId?: string; staffId?: string } {
  if (typeof window === 'undefined') return { role: 'admin' }
  try {
    if (localStorage.getItem('accountant_token')) return { role: 'accountant' }
    const userData = localStorage.getItem('UserData')
    if (userData) {
      const p = JSON.parse(userData)
      if (p?.Dealer_Id) return { role: 'dealer', dealerId: p.Dealer_Id }
      if (p?.staff_id) return {
        role: p.staff_roletype === '0' ? 'admin' : 'staff',
        staffId: p.staff_id,
      }
      if (localStorage.getItem('roletype') === '3') return { role: 'admin' }
    }
    const staffRaw = localStorage.getItem('staffData')
    if (staffRaw) {
      const p = JSON.parse(staffRaw)
      if (p?.staff_id) return {
        role: p.staff_roletype === '0' ? 'admin' : 'staff',
        staffId: p.staff_id,
      }
    }
    const adminRaw = localStorage.getItem('AdminData') || localStorage.getItem('admin')
    if (adminRaw) return { role: 'admin' }
  } catch (_) {}
  return { role: 'admin' }
}

function initials(name: string) {
  return name?.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
}

function statusBadge(s: string) {
  return s === '1'
    ? { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Active' }
    : { bg: 'bg-red-50',     text: 'text-red-600',     label: 'Inactive' }
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function LedgerDealerListPage() {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [role,        setRole]        = useState<AppRole>('admin')
  const [staffId,     setStaffId]     = useState<string | undefined>()
  const [redirecting, setRedirecting] = useState(true)
  const [page,        setPage]        = useState(1)
  const [search,      setSearch]      = useState('')
  const [searchInput, setSearchInput] = useState('')

  // ── Resolve role & redirect dealers ──
  useEffect(() => {
    const { role: r, dealerId, staffId: sid } = resolveRole()
    setRole(r)
    setStaffId(sid)
    if (r === 'dealer' && dealerId) {
      router.replace(`/Pages/ledger/${dealerId}`)
    } else {
      setRedirecting(false)
    }
  }, [router])

  // ── Debounced search ──
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setSearch(searchInput) }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  // ── Fetch dealers (admin/accountant: paginated API) ──
  const { data: response, isLoading: isPaginatedLoading, isError: isPaginatedError } = useQuery<DealerResponse>({
    queryKey: ['ledger-dealers', page, search],
    queryFn: async () => {
      const res = await fetch(`${BACKEND_URL}/dealerpegination?page=${page}&search=${search}`)
      return res.json()
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    enabled: !redirecting && role !== 'staff',
  })

  // ── Fetch staff-assigned dealers (staff only) ──
  const { data: staffDealersResponse, isLoading: isStaffLoading, isError: isStaffError } = useQuery<StaffDealerResponse>({
    queryKey: ['staff-assigned-dealers', staffId],
    queryFn: async () => {
      const res = await fetch(`${BACKEND_URL}/staffDealers?id=${staffId}`)
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    enabled: !redirecting && role === 'staff' && !!staffId,
  })

  // ── Prefetch next page (admin/accountant only) ──
  useEffect(() => {
    if (redirecting || role === 'staff') return
    queryClient.prefetchQuery({
      queryKey: ['ledger-dealers', page + 1, search],
      queryFn: async () => {
        const res = await fetch(`${BACKEND_URL}/dealerpegination?page=${page + 1}&search=${search}`)
        return res.json()
      },
    })
  }, [page, search, redirecting, queryClient, role])

  // ── Derive data based on role ──
  const isStaffRole = role === 'staff'
  const isLoading = isStaffRole ? isStaffLoading : isPaginatedLoading
  const isError = isStaffRole ? isStaffError : isPaginatedError

  // Staff: client-side search + pagination over assigned dealers
  const staffFilteredDealers = useMemo(() => {
    if (!isStaffRole || !staffDealersResponse?.data) return []
    const all = staffDealersResponse.data
    if (!search) return all
    const q = search.toLowerCase()
    return all.filter(d =>
      d.Dealer_Name?.toLowerCase().includes(q) ||
      d.Dealer_City?.toLowerCase().includes(q) ||
      d.Dealer_Email?.toLowerCase().includes(q) ||
      d.Dealer_Number?.includes(q)
    )
  }, [isStaffRole, staffDealersResponse?.data, search])

  // Admin/accountant: use paginated API data
  const paginatedData: Dealer[] = response?.data || []

  // Unified data for the current page
  const data: Dealer[] = isStaffRole
    ? staffFilteredDealers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
    : paginatedData

  const total = isStaffRole
    ? staffFilteredDealers.length
    : (typeof response?.total === 'number'
        ? response.total
        : (page - 1) * ITEMS_PER_PAGE + paginatedData.length)

  const totalPages = isStaffRole
    ? Math.max(1, Math.ceil(staffFilteredDealers.length / ITEMS_PER_PAGE))
    : (response?.last_page ||
       Math.ceil(total / ITEMS_PER_PAGE) ||
       (paginatedData.length < ITEMS_PER_PAGE ? page : page + 1))

  function pageNumbers(): (number | '…')[] {
    const pages: (number | '…')[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push('…')
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
      if (page < totalPages - 2) pages.push('…')
      pages.push(totalPages)
    }
    return pages
  }

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return
    setPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startIndex = (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex   = Math.min(page * ITEMS_PER_PAGE, total)

  // ── Dealer redirect → loading spinner ──
  if (redirecting) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 32, height: 32,
              border: '3px solid #e5e7eb', borderTopColor: '#6366f1',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Loading ledger…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    )
  }

  // ── Admin / Accountant / Staff list view ──
  return (
    <div className="min-h-screen bg-gray-100">
      <div className="p-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <BookOpen size={16} className="text-indigo-600" />
                </div>
                <h1 className="text-3xl font-bold text-gray-900">Dealer Ledger</h1>
              </div>
              <p className="text-sm text-gray-500 mt-1 ml-12">
                {isStaffRole
                  ? 'View ledger accounts for your assigned dealers'
                  : 'Select a dealer to view their full ledger account'}
              </p>
            </div>
            {isStaffRole && (
              <span className="px-3 py-1.5 bg-indigo-50 text-indigo-600 text-xs font-semibold rounded-full border border-indigo-200">
                Assigned Dealers Only
              </span>
            )}
          </div>

          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search dealers…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition w-full"
            />
          </div>
        </div>

        {isError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            Failed to load dealers. Please try again.
          </div>
        )}

        {/* Table Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">S.No.</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Dealer</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">City</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Email</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Phone</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-4 w-16" />
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {/* Shimmer */}
                {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className={`${SHIMMER} h-4 w-full`} />
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Empty */}
                {!isLoading && data.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-400 text-sm">
                      {search
                        ? 'No dealers found matching your search'
                        : isStaffRole
                          ? 'No dealers assigned to you'
                          : 'No dealers found'}
                    </td>
                  </tr>
                )}

                {/* Rows */}
                {!isLoading && data.map((dealer, i) => {
                  const badge = statusBadge(dealer.status)
                  return (
                    <tr
                      key={dealer.Dealer_Id}
                      onClick={() => router.push(`/Pages/ledger/${dealer.Dealer_Id}`)}
                      className="hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                    >
                      <td className="px-4 py-4 text-gray-400 text-xs">{startIndex + i}</td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-semibold shrink-0">
                            {initials(dealer.Dealer_Name)}
                          </div>
                          <span className="font-medium text-gray-800 group-hover:text-indigo-700 transition-colors">
                            {dealer.Dealer_Name || '—'}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <span className="bg-blue-50 text-blue-600 text-xs font-medium px-2.5 py-1 rounded-full">
                          {dealer.Dealer_City || '—'}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-gray-500 text-xs">{dealer.Dealer_Email || '—'}</td>
                      <td className="px-4 py-4 text-gray-600 text-xs">{dealer.Dealer_Number || '—'}</td>

                      <td className="px-4 py-4">
                        <span className={`${badge.bg} ${badge.text} text-xs font-medium px-2.5 py-1 rounded-full`}>
                          {badge.label}
                        </span>
                      </td>

                      {/* View Ledger button */}
                      <td className="px-4 py-4">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            router.push(`/Pages/ledger/${dealer.Dealer_Id}`)
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                          title="View Ledger"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              {data.length > 0 ? `Showing ${startIndex}–${endIndex} of ${total}` : 'No results'}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                ← Prev
              </button>

              {pageNumbers().map((p, idx) =>
                p === '…' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-gray-400 text-sm">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                      p === page
                        ? 'bg-indigo-600 text-white border-indigo-600 font-medium'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}

              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Next →
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}