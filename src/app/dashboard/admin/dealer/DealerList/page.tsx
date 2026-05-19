'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import axios from 'axios'
import { Search, Trash2, BookOpen, Pencil, MoreVertical, Eye } from 'lucide-react'

type Dealer = {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_City: string
  Dealer_Email: string
  Dealer_Number: string
  Dealer_Address: string
  Dealer_Pincode: string
  Dealer_Username: string
  Dealer_Password: string
  Dealer_Dealercode: string
  Dealer_Notes: string
  Dealer_Image: string
  status: string
  assignedstaff: string
  staffname: string
  discount: string
  gst: string
  creditdays: string
  annualtarget: string
  currentlimit: string
}

type DealerResponse = {
  data: Dealer[]
  total: number
  last_page: number
}

type AppRole = "admin" | "staff" | "accountant"

const SHIMMER = "animate-pulse bg-gray-200 rounded"
const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api"
const ITEMS_PER_PAGE = 10

function initials(name: string) {
  return name?.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?"
}

function statusBadge(s: string) {
  return s === "1"
    ? { bg: "bg-emerald-50", text: "text-emerald-700", label: "Active" }
    : { bg: "bg-red-50",     text: "text-red-600",     label: "Inactive" }
}

function getRole(): AppRole {
  if (typeof window === "undefined") return "admin"
  if (localStorage.getItem("accountant_token")) return "accountant"
  const rt = localStorage.getItem("roletype")
  if (rt === "1") return "staff"
  return "admin"
}

export default function DealerListPage() {
  const router = useRouter()

  const [role,          setRole]          = useState<AppRole>("admin")
  const [page,          setPage]          = useState(1)
  const [search,        setSearch]        = useState("")
  const [searchInput,   setSearchInput]   = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [toastMsg,      setToastMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [openMenuId,    setOpenMenuId]    = useState<string | null>(null)

  const queryClient = useQueryClient()

  useEffect(() => { setRole(getRole()) }, [])

  // Close menu on outside click
  useEffect(() => {
    const handler = () => setOpenMenuId(null)
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [])

  // Toast auto-dismiss
  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3000)
    return () => clearTimeout(t)
  }, [toastMsg])

  const { data: response, isLoading, isError, refetch } = useQuery<DealerResponse>({
    queryKey: ['dealers', page, search],
    queryFn: async () => {
      const res = await fetch(`${BACKEND_URL}/dealerpegination?page=${page}&search=${search}`)
      return res.json()
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const data: Dealer[] = response?.data || []

  const total =
    typeof response?.total === "number"
      ? response.total
      : (page - 1) * ITEMS_PER_PAGE + data.length

  const totalPages =
    response?.last_page ||
    Math.ceil(total / ITEMS_PER_PAGE) ||
    (data.length < ITEMS_PER_PAGE ? page : page + 1)

  // Prefetch next page
  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ['dealers', page + 1, search],
      queryFn: async () => {
        const res = await fetch(`${BACKEND_URL}/dealerpegination?page=${page + 1}&search=${search}`)
        return res.json()
      },
    })
  }, [page, search])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setSearch(searchInput) }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const handleDelete = async (id: string) => {
    try {
      const fd = new FormData()
      fd.append("id", id)
      fd.append("tbl", "dealer_tbl")
      fd.append("field", "Dealer_Id")
      const res = await axios.post(`${BACKEND_URL}/delete`, fd)
      setToastMsg({ text: res.data.msg || "Dealer deleted", type: 'success' })
      refetch()
    } catch {
      setToastMsg({ text: "Failed to delete dealer", type: 'error' })
    } finally {
      setDeleteConfirm(null)
    }
  }

  function pageNumbers(): (number | "…")[] {
    const pages: (number | "…")[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push("…")
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
      if (page < totalPages - 2) pages.push("…")
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

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Toast */}
      {toastMsg && (
        <div className={`fixed top-5 right-5 z-50 text-sm px-4 py-3 rounded-lg shadow-lg transition-all flex items-center gap-2 ${
          toastMsg.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
        }`}>
          {toastMsg.type === 'success'
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6 9 17l-5-5"/></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
          }
          {toastMsg.text}
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80 border border-gray-200">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-red-500" />
              </div>
              <h3 className="font-semibold text-gray-900">Delete Dealer</h3>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              Are you sure you want to delete this dealer? This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Dealer List</h1>
              <p className="text-sm text-gray-500 mt-1">Manage all registered dealers</p>
            </div>
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
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Password</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-4 w-12" />
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {/* Shimmer */}
                {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className={`${SHIMMER} h-4 w-full`} />
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Empty */}
                {!isLoading && data.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-gray-400 text-sm">
                      No dealers found
                    </td>
                  </tr>
                )}

                {/* Rows */}
                {!isLoading && data.map((dealer, i) => {
                  const badge  = statusBadge(dealer.status)
                  const isOpen = openMenuId === dealer.Dealer_Id
                  return (
                    <tr key={dealer.Dealer_Id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 text-gray-400 text-xs">{startIndex + i}</td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-semibold shrink-0">
                            {initials(dealer.Dealer_Name)}
                          </div>
                          <span className="font-medium text-gray-800">{dealer.Dealer_Name || "—"}</span>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <span className="bg-blue-50 text-blue-600 text-xs font-medium px-2.5 py-1 rounded-full">
                          {dealer.Dealer_City || "—"}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-gray-500 text-xs">{dealer.Dealer_Email || "—"}</td>
                      <td className="px-4 py-4 text-gray-600 text-xs">{dealer.Dealer_Number || "—"}</td>

                      <td className="px-4 py-4 font-mono text-xs text-gray-400 tracking-widest">
                        ••••••••
                      </td>

                      <td className="px-4 py-4">
                        <span className={`${badge.bg} ${badge.text} text-xs font-medium px-2.5 py-1 rounded-full`}>
                          {badge.label}
                        </span>
                      </td>

                      {/* 3-dot action menu */}
                      <td className="px-4 py-4">
                        <div className="relative flex justify-end">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setOpenMenuId(isOpen ? null : dealer.Dealer_Id)
                            }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition"
                            aria-label="Actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {isOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-8 z-20 bg-white rounded-xl border border-gray-200 shadow-xl py-1 min-w-[152px]"
                            >
                              {/* View Ledger — all roles */}
                              <button
                                onClick={() => {
                                  router.push(`/dashboard/admin/dealer/${dealer.Dealer_Id}/ledger`)
                                  setOpenMenuId(null)
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 text-left transition-colors"
                              >
                                <BookOpen className="w-3.5 h-3.5 shrink-0" />
                                View Ledger
                              </button>

                              {/* View & Edit & Delete — staff only */}
                              {role === "staff" && (
                                <>
                                  <div className="my-1 h-px bg-gray-100 mx-2" />
                                  <button
                                    onClick={() => {
                                      router.push(`/dashboard/staff/dealer/${dealer.Dealer_Id}`)
                                      setOpenMenuId(null)
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 text-left transition-colors"
                                  >
                                    <Eye className="w-3.5 h-3.5 shrink-0" />
                                    View
                                  </button>
                                  <div className="my-1 h-px bg-gray-100 mx-2" />
                                  <button
                                    onClick={() => {
                                      router.push(`/dashboard/admin/dealer/${dealer.Dealer_Id}`)
                                      setOpenMenuId(null)
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-gray-700 hover:bg-gray-50 text-left transition-colors"
                                  >
                                    <Pencil className="w-3.5 h-3.5 shrink-0" />
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => {
                                      setDeleteConfirm(dealer.Dealer_Id)
                                      setOpenMenuId(null)
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-600 hover:bg-red-50 text-left transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
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
              {data.length > 0 ? `Showing ${startIndex}–${endIndex} of ${total}` : "No results"}
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
                p === "…" ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-gray-400 text-sm">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    className={`px-3 py-1.5 text-sm rounded-lg border transition ${
                      p === page
                        ? "bg-indigo-600 text-white border-indigo-600 font-medium"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
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
