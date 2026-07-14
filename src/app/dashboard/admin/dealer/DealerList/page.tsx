'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import axios from 'axios'
import { Search, Trash2, Eye, EyeOff, MoreVertical } from 'lucide-react'
import { confirmAlert } from 'react-confirm-alert'
import {
  dealerStatusBadge,
  fetchDealerStatusOverrides,
  normalizeDealerStatus,
  saveDealerStatus,
  type DealerStatus,
  type DealerStatusDocument,
} from "@/lib/dealerStatus"

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
const getDealerEditRoute = (dealerId: string) => `/dashboard/admin/dealer/${encodeURIComponent(dealerId)}`
const getDealerViewRoute = (dealerId: string) => `${getDealerEditRoute(dealerId)}/view`
const getStaffDealerRoute = (dealerId: string) => `/dashboard/staff/dealer/${encodeURIComponent(dealerId)}`

function statusBadge(s: string) {
  return dealerStatusBadge(normalizeDealerStatus(s))
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const text = await res.text()
  const preview = text.replace(/\s+/g, " ").trim().slice(0, 180)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (/^\s*</.test(text)) throw new Error("Expected JSON but received HTML")
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(preview ? "Invalid JSON response" : "Empty response")
  }
}

function getRole(): AppRole {
  if (typeof window === "undefined") return "admin"
  if (localStorage.getItem("accountant_token")) return "accountant"
  const rt = localStorage.getItem("roletype")
  if (rt === "1") return "staff"
  return "admin"
}

export default function DealerListPage() {
  const [role]          = useState<AppRole>(() => getRole())
  const [page,          setPage]          = useState(1)
  const [search,        setSearch]        = useState("")
  const [searchInput,   setSearchInput]   = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [toastMsg,      setToastMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(() => new Set())
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)
  const [statusOverrides, setStatusOverrides] = useState<Record<string, DealerStatus>>({})

  const queryClient = useQueryClient()

  // Toast auto-dismiss
  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3000)
    return () => clearTimeout(t)
  }, [toastMsg])

  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      const path = typeof e.composedPath === "function" ? e.composedPath() : []
      if (Array.isArray(path) && path.some((el) => el instanceof HTMLElement && el.dataset.menuId)) return
      let node: Node | null = e.target instanceof Node ? e.target : null
      while (node) {
        if (node instanceof HTMLElement && node.dataset.menuId) return
        node = node.parentNode
      }
      setOpenMenu(null)
    }
    document.addEventListener('click', handleDocClick)
    return () => document.removeEventListener('click', handleDocClick)
  }, [])

  const { data: response, isLoading, isError, refetch } = useQuery<DealerResponse>({
    queryKey: ['dealers', page, search],
    queryFn: async () => {
      return fetchJson<DealerResponse>(`${BACKEND_URL}/dealerpegination?page=${page}&search=${search}`)
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const {
    data: statusResponse,
    isError: statusLoadError,
  } = useQuery<DealerStatusDocument[]>({
    queryKey: ["dealer-statuses"],
    queryFn: fetchDealerStatusOverrides,
    staleTime: 5 * 60 * 1000,
  })

  const statusMap = useMemo(() => {
    const nextMap = new Map(
      (statusResponse ?? []).map((row) => [String(row.dealerId), normalizeDealerStatus(row.status)])
    )

    Object.entries(statusOverrides).forEach(([dealerId, status]) => {
      nextMap.set(String(dealerId), normalizeDealerStatus(status))
    })

    return nextMap
  }, [statusResponse, statusOverrides])

  const data: Dealer[] = useMemo(() => {
    return (response?.data || []).map((dealer) => ({
      ...dealer,
      status: statusMap.get(String(dealer.Dealer_Id)) ?? normalizeDealerStatus(dealer.status),
    }))
  }, [response?.data, statusMap])

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
        return fetchJson<DealerResponse>(`${BACKEND_URL}/dealerpegination?page=${page + 1}&search=${search}`)
      },
    })
  }, [page, search, queryClient])

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

  const updateDealerStatus = async (dealerId: string, nextStatus: DealerStatus) => {
    const normalizedDealerId = String(dealerId)
    setStatusUpdatingId(normalizedDealerId)
    try {
      const updatedStatus = await saveDealerStatus({
        dealerId: normalizedDealerId,
        status: nextStatus,
        updatedBy: role,
      })

      const normalizedStatus = normalizeDealerStatus(updatedStatus.status)

      setStatusOverrides((prev) => ({
        ...prev,
        [normalizedDealerId]: normalizedStatus,
      }))

      queryClient.setQueryData<DealerStatusDocument[]>(["dealer-statuses"], (previous = []) => {
        const nextEntry: DealerStatusDocument = {
          dealerId: normalizedDealerId,
          status: normalizedStatus,
          updatedAt: updatedStatus.updatedAt,
          ...(updatedStatus.updatedBy ? { updatedBy: updatedStatus.updatedBy } : {}),
        }

        const existingIndex = previous.findIndex((row) => String(row.dealerId) === normalizedDealerId)
        if (existingIndex === -1) return [nextEntry, ...previous]

        return previous.map((row, index) => (
          index === existingIndex
            ? nextEntry
            : row
        ))
      })

      setToastMsg({
        text: normalizedStatus === "active"
          ? "Dealer activated successfully."
          : "Dealer deactivated successfully.",
        type: 'success',
      })
      setOpenMenu(null)
    } catch (error) {
      console.error("Failed to update dealer status", error)
      setToastMsg({
        text: error instanceof Error ? error.message : "Failed to update dealer status",
        type: 'error',
      })
    } finally {
      setStatusUpdatingId(null)
    }
  }

  const confirmDealerStatusChange = (dealer: Dealer) => {
    const dealerId = String(dealer.Dealer_Id)
    const currentStatus = normalizeDealerStatus(dealer.status)
    const nextStatus: DealerStatus = currentStatus === "active" ? "inactive" : "active"
    const isDeactivating = nextStatus === "inactive"
    const dealerName = dealer.Dealer_Name || `Dealer ${dealerId}`

    confirmAlert({
      customUI: ({ onClose }) => (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isDeactivating ? "bg-red-50" : "bg-emerald-50"}`}>
                <span className={`text-sm font-semibold ${isDeactivating ? "text-red-600" : "text-emerald-600"}`}>
                  {isDeactivating ? "!" : "?"}
                </span>
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">
                  {isDeactivating ? "Deactivate Dealer" : "Activate Dealer"}
                </h3>
                <p className="text-sm text-gray-500">{dealerName}</p>
              </div>
            </div>

            <p className="text-sm leading-6 text-gray-600">
              {isDeactivating
                ? "This dealer will no longer be able to access the dealer application until the account is activated again."
                : "This dealer will be able to access the dealer application again after activation."}
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  void updateDealerStatus(dealerId, nextStatus)
                }}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition ${
                  isDeactivating ? "bg-red-500 hover:bg-red-600" : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {isDeactivating ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>
        </div>
      ),
    })
  }

  function pageNumbers(): (number | "...")[] {
    const pages: (number | "...")[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      if (page > 3) pages.push("...")
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
      if (page < totalPages - 2) pages.push("...")
      pages.push(totalPages)
    }
    return pages
  }

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return
    setPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const togglePassword = (dealerId: string) => {
    setVisiblePasswords(prev => {
      const next = new Set(prev)
      if (next.has(dealerId)) next.delete(dealerId)
      else next.add(dealerId)
      return next
    })
  }

  const canManageDealers = role === "admin" || role === "staff"
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
              placeholder="Search dealers..."
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

        {statusLoadError && (
          <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            Dealer status sync could not load from MongoDB. Showing the last known backend status until it recovers.
          </div>
        )}
      
        <div className="mb-4 flex justify-end gap-2">
          <Link
            href={role === "staff" ? "/dashboard/staff/dealer-requests" : "/dashboard/admin/dealer/requests"}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Dealer Requests
          </Link>
          <button
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
            onClick={() => window.location.href = "/dashboard/admin/dealer/AddDealerForm"}
          >
            Add dealer
          </button>
        </div>

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
                  <th className="px-4 py-4 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
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
                  const passwordVisible = visiblePasswords.has(dealer.Dealer_Id)
                  return (
                    <tr key={dealer.Dealer_Id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 text-gray-400 text-xs">{startIndex + i}</td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          {/* <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-semibold shrink-0">
                            {initials(dealer.Dealer_Name)}
                          </div> */}
                          <Link
                            href={getDealerEditRoute(dealer.Dealer_Id)}
                            className="font-medium text-gray-800 hover:text-indigo-700 transition-colors"
                          >
                            {dealer.Dealer_Name || "-"}
                          </Link>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <span className="bg-blue-50 text-blue-600 text-xs font-medium px-2.5 py-1 rounded-full">
                          {dealer.Dealer_City || "-"}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-gray-500 text-xs">{dealer.Dealer_Email || "-"}</td>
                      <td className="px-4 py-4 text-gray-600 text-xs">{dealer.Dealer_Number || "-"}</td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-xs ${passwordVisible ? "text-gray-700 tracking-normal" : "text-gray-400 tracking-widest"}`}>
                            {passwordVisible ? dealer.Dealer_Password || "-" : "********"}
                          </span>
                          {role === "admin" && dealer.Dealer_Password && (
                            <button
                              type="button"
                              onClick={() => togglePassword(dealer.Dealer_Id)}
                              className="p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                              aria-label={passwordVisible ? "Hide dealer password" : "Show dealer password"}
                              title={passwordVisible ? "Hide password" : "Show password"}
                            >
                              {passwordVisible
                                ? <EyeOff className="w-3.5 h-3.5" />
                                : <Eye className="w-3.5 h-3.5" />
                              }
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <span className={`${badge.bg} ${badge.text} text-xs font-medium px-2.5 py-1 rounded-full`}>
                          {badge.label}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <div className="relative">
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenMenu(prev => prev === dealer.Dealer_Id ? null : dealer.Dealer_Id) }}
                              data-menu-id={dealer.Dealer_Id}
                              className="p-2 rounded-md text-gray-600 hover:bg-gray-50 transition"
                              aria-label="Open actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {openMenu === dealer.Dealer_Id && (
                              <div onClick={(e) => e.stopPropagation()} data-menu-id={dealer.Dealer_Id} className="absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-md shadow-lg z-10 py-1">
                                <Link href={getDealerViewRoute(dealer.Dealer_Id)} className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">View</Link>
                                {role === 'staff' && <Link href={getStaffDealerRoute(dealer.Dealer_Id)} className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">View (staff)</Link>}
                                {canManageDealers && (
                                  <>
                                    <Link href={getDealerEditRoute(dealer.Dealer_Id)} className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Edit</Link>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); confirmDealerStatusChange(dealer) }}
                                      disabled={statusUpdatingId === String(dealer.Dealer_Id)}
                                      className="w-full text-left px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {statusUpdatingId === String(dealer.Dealer_Id)
                                        ? "Updating..."
                                        : normalizeDealerStatus(dealer.status) === "active"
                                          ? "Deactivate"
                                          : "Activate"}
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(dealer.Dealer_Id); setOpenMenu(null) }} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50">Delete</button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
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
                Prev
              </button>

              {pageNumbers().map((p, idx) =>
                p === "..." ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-gray-400 text-sm">...</span>
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
                Next
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
