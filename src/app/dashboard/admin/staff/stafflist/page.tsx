'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import axios from 'axios'
import { Pencil, Trash2, Download, Search, Users, Eye, EyeOff, MoreVertical } from 'lucide-react'

type StaffData = {
  staff_id: string
  staff_name: string
  staff_email: string
  staff_roletype: string
  staff_password: string
  staff_designation: string
  staff_location: string
  status: string
}

type StaffResponse = {
  data: StaffData[]
  count: number
  last_page: number
}

const SHIMMER = "animate-pulse bg-gray-200 rounded"
const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api"
const ITEMS_PER_PAGE = 10
const getStaffEditRoute = (staffId: string) => `/dashboard/admin/staff/${encodeURIComponent(staffId)}`

function roleBadge(role: string) {
  switch (role) {
    case "1": return { bg: "bg-indigo-50", text: "text-indigo-700", label: "Executive" }
    case "2": return { bg: "bg-violet-50", text: "text-violet-700", label: "Field Executive" }
    default:  return { bg: "bg-gray-100",  text: "text-gray-500",   label: "Unknown" }
  }
}

function initials(name: string) {
  return name?.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?"
}

type AppRole = "admin" | "staff" | "accountant"

function getRole(): AppRole {
  if (typeof window === 'undefined') return 'admin'
  if (localStorage.getItem('accountant_token')) return 'accountant'
  const rt = localStorage.getItem('roletype')
  if (rt === '1') return 'staff'
  return 'admin'
}

export default function StaffListPage() {
  const [page,          setPage]          = useState(1)
  const [search,        setSearch]        = useState("")
  const [searchInput,   setSearchInput]   = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [toastMsg,      setToastMsg]      = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(() => new Set())
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [role, setRole] = useState<AppRole>('admin')

  const queryClient = useQueryClient()

  // Toast auto-dismiss
  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3000)
    return () => clearTimeout(t)
  }, [toastMsg])

  useEffect(() => { setRole(getRole()) }, [])

  useEffect(() => {
    const handleDocClick = (e: any) => {
      const path = (e?.composedPath && e.composedPath()) || e?.path || []
      if (Array.isArray(path) && path.some((el: any) => el?.dataset?.menuId)) return
      let node = e?.target
      while (node) {
        if (node?.dataset && node.dataset.menuId) return
        node = node.parentNode
      }
      setOpenMenu(null)
    }
    document.addEventListener('click', handleDocClick)
    return () => document.removeEventListener('click', handleDocClick)
  }, [])

  const { data: response, isLoading, isError, refetch } = useQuery<StaffResponse>({
    queryKey: search ? ['stafflist', page, search] : ['stafflist', 'all'],
    queryFn: async () => {
      // If user is searching, use normal paginated endpoint.
      if (search) {
        const res = await axios.get(
          `${BACKEND_URL}/staffpegination?page=${page}&limit=${ITEMS_PER_PAGE}&search=${search}`
        )
        return res.data
      }

      // No search -> fetch all pages from server and combine results so UI can display full list.
      const first = await axios.get(`${BACKEND_URL}/staffpegination?page=1&limit=${ITEMS_PER_PAGE}&search=`)
      const firstRaw = first.data || {}
      const firstData: StaffResponse = {
        data: firstRaw.data || [],
        count: firstRaw.count ?? firstRaw.total ?? firstRaw.totalRecords ?? 0,
        last_page: firstRaw.last_page ?? firstRaw.lastpage ?? firstRaw.lastPage ?? undefined,
      }
      // Derive last page: prefer explicit last_page, else compute from total count.
      // If server ignores our `limit` value, infer the server page size from firstData.length.
      const perPageUsed = (firstData.data && firstData.data.length > 0) ? firstData.data.length : ITEMS_PER_PAGE
      const derivedLast = firstData.last_page ?? (firstData.count ? Math.ceil(firstData.count / perPageUsed) : 1)
      const lastPage = Math.max(1, derivedLast || 1)
      let allData: StaffData[] = firstData.data || []

      if (lastPage > 1) {
        const requests: Promise<any>[] = []
        for (let p = 2; p <= lastPage; p++) {
          requests.push(axios.get(`${BACKEND_URL}/staffpegination?page=${p}&limit=${ITEMS_PER_PAGE}&search=`))
        }
        const pages = await Promise.all(requests)
        for (const r of pages) {
          const d = r.data
          if (d?.data) allData = allData.concat(d.data)
        }
      }

      return { data: allData, count: firstData.count || allData.length, last_page: 1 }
    },
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const data: StaffData[] = response?.data || []
  const totalFromServer = response?.count ?? 0
  const total = totalFromServer || data.length
  const serverLastPage = response?.last_page ?? 0
  const totalPages = serverLastPage > 1 ? serverLastPage : Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))

  // If server returns a full dataset (no server-side pagination), paginate on the client
  const serverPaging = serverLastPage > 1
  const displayedData: StaffData[] = serverPaging ? data : data.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  // Prefetch next page (only when searching / using server pagination)
  useEffect(() => {
    if (!search) return
    if (page >= totalPages) return
    queryClient.prefetchQuery({
      queryKey: ['stafflist', page + 1, search],
      queryFn: async () => {
        const res = await axios.get(
          `${BACKEND_URL}/staffpegination?page=${page + 1}&limit=${ITEMS_PER_PAGE}&search=${search}`
        )
        return res.data
      },
    })
  }, [page, search, totalPages, queryClient])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
      setSearch(searchInput)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const handleDelete = async (id: string) => {
    try {
      const formData = new FormData()
      formData.append("id", id)
      formData.append("tbl", "staff_tbl")
      formData.append("field", "staff_id")
      const res = await axios.post(`${BACKEND_URL}/delete`, formData)
      setToastMsg({ text: res.data.msg || "Staff deleted", type: 'success' })
      refetch()
    } catch {
      setToastMsg({ text: "Failed to delete staff", type: 'error' })
    } finally {
      setDeleteConfirm(null)
    }
  }

  const handleDownloadCSV = () => {
    if (!data.length) return
    const headers = ["S.No.", "Name", "Email", "Role", "Password"]
    const rows = data.map((s, i) => [
      (page - 1) * ITEMS_PER_PAGE + i + 1,
      s.staff_name,
      s.staff_email,
      s.staff_roletype === "1" ? "Executive" : s.staff_roletype === "2" ? "Field Executive" : "",
      s.staff_password,
    ])
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "staff-list.csv"
    a.click()
    URL.revokeObjectURL(url)
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

  const startIndex = (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex = Math.min(page * ITEMS_PER_PAGE, total)

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Toast */}
      {toastMsg && (
        <div className={`fixed top-5 right-5 z-50 text-sm px-4 py-3 rounded-lg shadow-lg transition-all ${
          toastMsg.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
        }`}>
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
              <h3 className="font-semibold text-gray-900">Delete Staff</h3>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              Are you sure you want to delete this staff member? This action cannot be undone.
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
              <h1 className="text-3xl font-bold text-gray-900">Staff List</h1>
              <p className="text-sm text-gray-500 mt-1">
                {total > 0 ? `${total} staff member${total !== 1 ? "s" : ""} total` : "Manage all registered staff members"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadCSV}
                disabled={!data.length}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-sm"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name..."
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition w-full"
            />
          </div>
        </div>

        {isError && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            Failed to load staff data. Please try again.
          </div>
        )}

        {/* Table Card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">S.No.</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Name</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Email</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Role</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Password</th>
                  <th className="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {/* Shimmer */}
                {isLoading && Array.from({ length: ITEMS_PER_PAGE }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-4">
                        <div className={`${SHIMMER} h-4 w-full`} />
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Empty */}
                {!isLoading && data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-400">
                        <Users className="w-8 h-8" />
                        <span className="text-sm">No staff members found</span>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Rows */}
                {!isLoading && displayedData.map((staff, i) => {
                  const badge = roleBadge(staff.staff_roletype)
                  return (
                    <tr key={staff.staff_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-4 text-gray-400 text-xs">{startIndex + i}</td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          {/* <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                            {initials(staff.staff_name)}
                          </div> */}
                          <span className="font-medium text-gray-800">{staff.staff_name || "-"}</span>
                        </div>
                      </td>

                      <td className="px-4 py-4 text-gray-500 text-xs">{staff.staff_email || "-"}</td>

                      <td className="px-4 py-4">
                        <span className={`${badge.bg} ${badge.text} text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap`}>
                          {badge.label}
                        </span>
                      </td>

                      <td className="px-4 py-4 font-mono text-xs tracking-widest">
                        {(() => {
                          const visible = visiblePasswords.has(staff.staff_id)
                          return (
                            <div className="flex items-center gap-2">
                              <span className={`${visible ? 'text-gray-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 select-all' : 'text-gray-300'}`}>
                                {visible ? staff.staff_password || "-" : "********"}
                              </span>
                              {role === 'admin' && staff.staff_password && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setVisiblePasswords(prev => {
                                    const next = new Set(prev)
                                    if (next.has(staff.staff_id)) next.delete(staff.staff_id)
                                    else next.add(staff.staff_id)
                                    return next
                                  })}}
                                  className="p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                                  aria-label={visible ? 'Hide staff password' : 'Show staff password'}
                                  title={visible ? 'Hide password' : 'Show password'}
                                >
                                  {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              )}
                            </div>
                          )
                        })()}
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <div className="relative">
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenMenu(prev => prev === staff.staff_id ? null : staff.staff_id) }}
                              data-menu-id={staff.staff_id}
                              className="p-2 rounded-md text-gray-600 hover:bg-gray-50 transition"
                              aria-label="Open actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {openMenu === staff.staff_id && (
                              <div onClick={(e) => e.stopPropagation()} data-menu-id={staff.staff_id} className="absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-md shadow-lg z-10 py-1">
                                <Link href={getStaffEditRoute(staff.staff_id)} className="block px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Edit</Link>
                                <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(staff.staff_id); setOpenMenu(null) }} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50">Delete</button>
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
              {data.length > 0
                ? `Showing ${startIndex}–${endIndex} of ${total} staff`
                : "No results"}
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
                disabled={page >= totalPages}
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
