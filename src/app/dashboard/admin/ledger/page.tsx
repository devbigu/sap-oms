'use client'

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { resolveOrderAmounts } from '@/lib/orderAmounts'
import { resolveStoredAuth } from '@/lib/roleAccess'

type AccountBook = {
  bookedCount?: number
}

type Dealer = {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_Email?: string
  Dealer_Number?: string
  Dealer_City?: string
  creditdays?: string | number
  creditDays?: string | number
  credit_period?: string | number
  Credit_Period?: string | number
  accountBook?: AccountBook
}

type RawOrder = {
  order_id?: string
  order_date?: string
  order_amount?: string | number
  order_discount?: string | number
  total?: string | number
}

type LedgerResponse = {
  success: boolean
  data: Dealer[]
  total: number
  isLive?: boolean
  updatedAt?: string
}

type DealerDetail = {
  dealer: Dealer
  orders: RawOrder[]
}

type Bill = {
  id: string
  dealerId: string
  orderNumber: string
  billAmount: number
  gstPercent: number
  billDate: string
  pdfName: string
  pdfUrl?: string
  paidAmount: number
  lastPaymentDate?: string
}

type Toast = {
  type: 'success' | 'error'
  text: string
}

const ITEMS_PER_PAGE = 10
const DEFAULT_CREDIT_DAYS = 60
const PAYMENT_MODES = ['Cash', 'Cheque', 'NEFT', 'UPI']
const EMPTY_BILL_FORM = {
  orderNumber: '',
  billAmount: '',
  gstPercent: '18',
  billDate: new Date().toISOString().slice(0, 10),
}
const EMPTY_PAYMENT_FORM = {
  amount: '',
  paymentMode: 'NEFT',
  paymentDate: new Date().toISOString().slice(0, 10),
  reference: '',
  notes: '',
}

function formatAmount(value: number | string | undefined) {
  const amount = Number(value || 0)
  return `Rs. ${amount.toLocaleString('en-IN', {
    minimumFractionDigits: amount % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(value: string | undefined) {
  if (!value) return '-'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return formatDateObject(date)
}

function formatDateObject(date: Date) {
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function addDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date
}

function getDaysRemaining(dateValue: string, creditDays: number) {
  const dueDate = addDays(dateValue, creditDays)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((dueDate.getTime() - today.getTime()) / 86_400_000)
}

function creditDaysForDealer(dealer?: Dealer) {
  const raw =
    dealer?.creditdays ??
    dealer?.creditDays ??
    dealer?.credit_period ??
    dealer?.Credit_Period
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_CREDIT_DAYS
}

function orderNumber(order: RawOrder) {
  return String(order.order_id || '').trim()
}

function orderLabel(order: RawOrder) {
  const number = orderNumber(order)
  if (!number) return 'Unnumbered order'
  return `OM/${new Date().getFullYear()}/${number}`
}

function orderAmount(order: RawOrder) {
  return resolveOrderAmounts(order).netPayable
}

function isStaffLedgerSession() {
  if (typeof window === 'undefined') return false
  const session = resolveStoredAuth(window.localStorage)
  return session.status === 'authenticated' && session.role === 'staff'
}

export default function DealerLedgerShellPage() {
  const router = useRouter()
  const [redirectingStaff, setRedirectingStaff] = useState(() => isStaffLedgerSession())
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [expandedDealerId, setExpandedDealerId] = useState<string | null>(null)
  const [dealerDetails, setDealerDetails] = useState<Record<string, DealerDetail>>({})
  const [loadingDealerId, setLoadingDealerId] = useState<string | null>(null)
  const [billsByDealer, setBillsByDealer] = useState<Record<string, Bill[]>>({})
  const [billDealer, setBillDealer] = useState<Dealer | null>(null)
  const [billForm, setBillForm] = useState(EMPTY_BILL_FORM)
  const [billFile, setBillFile] = useState<File | null>(null)
  const [paymentTarget, setPaymentTarget] = useState<{ dealer: Dealer; bill: Bill } | null>(null)
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT_FORM)
  const [isSavingBill, setIsSavingBill] = useState(false)
  const [isSavingPayment, setIsSavingPayment] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const objectUrls = useRef<string[]>([])

  useEffect(() => {
    if (!isStaffLedgerSession()) return
    setRedirectingStaff(true)
    router.replace('/Pages/ledger')
  }, [router])

  const { data, isLoading, error } = useQuery<LedgerResponse>({
    queryKey: ['dealer-ledger-shell'],
    queryFn: async () => {
      const res = await axios.get('/api/ledger')
      return res.data
    },
    staleTime: 5 * 60 * 1000,
    enabled: !redirectingStaff,
  })

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 350)

    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    return () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const dealers = useMemo(() => {
    const rows = data?.data || []
    if (!search) return rows

    const key = search.toLowerCase()
    return rows.filter((dealer) =>
      [
        dealer.Dealer_Name,
        dealer.Dealer_Email,
        dealer.Dealer_Number,
        dealer.Dealer_City,
        dealer.Dealer_Id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(key))
    )
  }, [data?.data, search])

  const totalPages = Math.max(1, Math.ceil(dealers.length / ITEMS_PER_PAGE))
  const pageRows = dealers.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
  const startIndex = dealers.length === 0 ? 0 : (page - 1) * ITEMS_PER_PAGE + 1
  const endIndex = Math.min(page * ITEMS_PER_PAGE, dealers.length)

  const showToast = (nextToast: Toast) => setToast(nextToast)

  const ensureDealerDetails = useCallback(
    async (dealer: Dealer) => {
      if (dealerDetails[dealer.Dealer_Id]) return dealerDetails[dealer.Dealer_Id]

      setLoadingDealerId(dealer.Dealer_Id)
      try {
        const res = await axios.get(`/api/ledger/${encodeURIComponent(dealer.Dealer_Id)}`)
        const detail: DealerDetail = {
          dealer: { ...dealer, ...(res.data?.dealer || {}) },
          orders: Array.isArray(res.data?.orders) ? res.data.orders : [],
        }
        setDealerDetails((prev) => ({ ...prev, [dealer.Dealer_Id]: detail }))
        return detail
      } catch (detailError) {
        console.error('[ledger dealer detail]', detailError)
        const fallback = { dealer, orders: [] }
        setDealerDetails((prev) => ({ ...prev, [dealer.Dealer_Id]: fallback }))
        showToast({ type: 'error', text: 'Could not load orders for this dealer' })
        return fallback
      } finally {
        setLoadingDealerId(null)
      }
    },
    [dealerDetails]
  )

  const handleExpand = async (dealer: Dealer) => {
    const isOpen = expandedDealerId === dealer.Dealer_Id
    setExpandedDealerId(isOpen ? null : dealer.Dealer_Id)
    if (!isOpen) await ensureDealerDetails(dealer)
  }

  const openBillModal = async (dealer: Dealer) => {
    setBillDealer(dealer)
    setBillForm(EMPTY_BILL_FORM)
    setBillFile(null)
    await ensureDealerDetails(dealer)
  }

  const closeBillModal = () => {
    setBillDealer(null)
    setBillForm(EMPTY_BILL_FORM)
    setBillFile(null)
  }

  const handleBillFile = (file: File | null) => {
    if (!file) {
      setBillFile(null)
      return
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      showToast({ type: 'error', text: 'Please upload a PDF bill' })
      return
    }

    setBillFile(file)
  }

  const submitBill = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!billDealer) return

    const amount = Number(billForm.billAmount)
    const gst = Number(billForm.gstPercent)

    if (!billForm.orderNumber || amount <= 0 || gst < 0 || !billForm.billDate) {
      showToast({ type: 'error', text: 'Fill all bill fields before saving' })
      return
    }

    setIsSavingBill(true)

    window.setTimeout(() => {
      let pdfUrl: string | undefined
      if (billFile) {
        pdfUrl = URL.createObjectURL(billFile)
        objectUrls.current.push(pdfUrl)
      }

      const bill: Bill = {
        id: `mock-bill-${billDealer.Dealer_Id}-${Date.now()}`,
        dealerId: billDealer.Dealer_Id,
        orderNumber: billForm.orderNumber,
        billAmount: amount,
        gstPercent: gst,
        billDate: billForm.billDate,
        pdfName: billFile?.name || 'Bill PDF pending',
        pdfUrl,
        paidAmount: 0,
      }

      setBillsByDealer((prev) => ({
        ...prev,
        [billDealer.Dealer_Id]: [bill, ...(prev[billDealer.Dealer_Id] || [])],
      }))
      setExpandedDealerId(billDealer.Dealer_Id)
      setIsSavingBill(false)
      closeBillModal()
      showToast({ type: 'success', text: 'Bill saved for demo ledger' })
    }, 500)
  }

  const openPaymentModal = (dealer: Dealer, bill: Bill) => {
    setPaymentTarget({ dealer, bill })
    setPaymentForm({
      ...EMPTY_PAYMENT_FORM,
      amount: String(Math.max(0, bill.billAmount - bill.paidAmount)),
    })
  }

  const closePaymentModal = () => {
    setPaymentTarget(null)
    setPaymentForm(EMPTY_PAYMENT_FORM)
  }

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!paymentTarget) return

    const amount = Number(paymentForm.amount)
    if (amount <= 0 || !paymentForm.paymentDate) {
      showToast({ type: 'error', text: 'Enter a valid payment amount and date' })
      return
    }

    setIsSavingPayment(true)
    let savedToApi = true

    try {
      await axios.post(`/api/ledger/${encodeURIComponent(paymentTarget.dealer.Dealer_Id)}/pay`, {
        amount,
        paymentMode: paymentForm.paymentMode,
        paymentDate: paymentForm.paymentDate,
        referenceId: paymentForm.reference || paymentTarget.bill.orderNumber,
        narration: paymentForm.notes || `Payment against bill ${paymentTarget.bill.orderNumber}`,
      })
    } catch (paymentError) {
      savedToApi = false
      console.error('[ledger payment]', paymentError)
    }

    setBillsByDealer((prev) => ({
      ...prev,
      [paymentTarget.dealer.Dealer_Id]: (prev[paymentTarget.dealer.Dealer_Id] || []).map((bill) =>
        bill.id === paymentTarget.bill.id
          ? {
              ...bill,
              paidAmount: Math.min(bill.billAmount, bill.paidAmount + amount),
              lastPaymentDate: paymentForm.paymentDate,
            }
          : bill
      ),
    }))

    setIsSavingPayment(false)
    closePaymentModal()
    showToast({
      type: 'success',
      text: savedToApi ? 'Payment recorded' : 'Payment saved locally for demo',
    })
  }

  if (redirectingStaff) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="mx-auto max-w-7xl rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
          Opening assigned dealer ledger...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="mx-auto max-w-7xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Failed to load dealer ledger data.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {toast && (
        <div
          className={`fixed right-5 top-5 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="mx-auto max-w-7xl p-6">
        <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Dealer Ledger</h1>
            <p className="mt-1 text-sm text-gray-500">Manage dealer bills, due dates, and payments</p>
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search dealers..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {data?.isLive === false && (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            Showing cached ledger data. Live billing data is temporarily unavailable.
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-12 px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600" />
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Dealer
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    City
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Orders
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Credit
                  </th>
                  <th className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {isLoading &&
                  Array.from({ length: ITEMS_PER_PAGE }).map((_, index) => (
                    <tr key={index}>
                      {Array.from({ length: 6 }).map((__, cellIndex) => (
                        <td key={cellIndex} className="px-4 py-4">
                          <div className="h-4 w-full animate-pulse rounded bg-gray-200" />
                        </td>
                      ))}
                    </tr>
                  ))}

                {!isLoading && pageRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-400">
                      {search ? 'No dealers match your search' : 'No dealers found'}
                    </td>
                  </tr>
                )}

                {!isLoading &&
                  pageRows.map((dealer) => {
                    const isExpanded = expandedDealerId === dealer.Dealer_Id
                    const creditDays = creditDaysForDealer(dealerDetails[dealer.Dealer_Id]?.dealer || dealer)
                    const bills = billsByDealer[dealer.Dealer_Id] || []
                    const orderCount = dealer.accountBook?.bookedCount ?? 0

                    return (
                      <FragmentRow
                        key={dealer.Dealer_Id}
                        dealer={dealer}
                        isExpanded={isExpanded}
                        isLoadingDetails={loadingDealerId === dealer.Dealer_Id}
                        creditDays={creditDays}
                        orderCount={orderCount}
                        bills={bills}
                        detail={dealerDetails[dealer.Dealer_Id]}
                        onExpand={() => handleExpand(dealer)}
                        onAddBill={() => openBillModal(dealer)}
                        onPayment={(bill) => openPaymentModal(dealer, bill)}
                      />
                    )
                  })}
              </tbody>
            </table>
          </div>

          {!isLoading && dealers.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-gray-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-gray-400">
                Showing {startIndex}-{endIndex} of {dealers.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-xs font-medium text-gray-500">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={page === totalPages}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {billDealer && (
        <ModalShell title="Add Bill" onClose={closeBillModal}>
          <form onSubmit={submitBill} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Order Number
              </label>
              <select
                value={billForm.orderNumber}
                onChange={(event) => setBillForm((prev) => ({ ...prev, orderNumber: event.target.value }))}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              >
                <option value="">Select order</option>
                {(dealerDetails[billDealer.Dealer_Id]?.orders || [])
                  .filter((order) => orderNumber(order))
                  .map((order) => (
                    <option key={orderNumber(order)} value={orderNumber(order)}>
                      {orderLabel(order)} - {formatAmount(orderAmount(order))}
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Bill Amount"
                type="number"
                min="0"
                step="0.01"
                value={billForm.billAmount}
                onChange={(value) => setBillForm((prev) => ({ ...prev, billAmount: value }))}
                required
              />
              <FormField
                label="GST %"
                type="number"
                min="0"
                step="0.01"
                value={billForm.gstPercent}
                onChange={(value) => setBillForm((prev) => ({ ...prev, gstPercent: value }))}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Bill Date"
                type="date"
                value={billForm.billDate}
                onChange={(value) => setBillForm((prev) => ({ ...prev, billDate: value }))}
                required
              />
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Bill PDF
                </label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => handleBillFile(event.target.files?.[0] || null)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-indigo-700"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeBillModal}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingBill}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
              >
                {isSavingBill && <Loader2 className="h-4 w-4 animate-spin" />}
                Save Bill
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {paymentTarget && (
        <ModalShell title="Record Payment" onClose={closePaymentModal}>
          <form onSubmit={submitPayment} className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {paymentTarget.dealer.Dealer_Name} - bill for order {paymentTarget.bill.orderNumber}
            </div>

            <FormField
              label="Payment Amount"
              type="number"
              min="0"
              step="0.01"
              value={paymentForm.amount}
              onChange={(value) => setPaymentForm((prev) => ({ ...prev, amount: value }))}
              required
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Payment Mode
                </label>
                <select
                  value={paymentForm.paymentMode}
                  onChange={(event) => setPaymentForm((prev) => ({ ...prev, paymentMode: event.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {PAYMENT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </div>

              <FormField
                label="Payment Date"
                type="date"
                value={paymentForm.paymentDate}
                onChange={(value) => setPaymentForm((prev) => ({ ...prev, paymentDate: value }))}
                required
              />
            </div>

            <FormField
              label="Reference / Notes"
              value={paymentForm.reference}
              onChange={(value) => setPaymentForm((prev) => ({ ...prev, reference: value }))}
            />

            <textarea
              value={paymentForm.notes}
              onChange={(event) => setPaymentForm((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Notes"
              rows={3}
              className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closePaymentModal}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingPayment}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {isSavingPayment && <Loader2 className="h-4 w-4 animate-spin" />}
                Record Payment
              </button>
            </div>
          </form>
        </ModalShell>
      )}
    </div>
  )
}

function FragmentRow({
  dealer,
  isExpanded,
  isLoadingDetails,
  creditDays,
  orderCount,
  bills,
  detail,
  onExpand,
  onAddBill,
  onPayment,
}: {
  dealer: Dealer
  isExpanded: boolean
  isLoadingDetails: boolean
  creditDays: number
  orderCount: number
  bills: Bill[]
  detail?: DealerDetail
  onExpand: () => void
  onAddBill: () => void
  onPayment: (bill: Bill) => void
}) {
  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-4">
          <button
            type="button"
            onClick={onExpand}
            className="rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
            aria-label={isExpanded ? 'Collapse dealer ledger' : 'Expand dealer ledger'}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-4 py-4">
          <button type="button" onClick={onExpand} className="text-left">
            <div className="font-semibold text-gray-900">{dealer.Dealer_Name || '-'}</div>
            <div className="mt-0.5 text-xs text-gray-500">{dealer.Dealer_Email || dealer.Dealer_Number || '-'}</div>
          </button>
        </td>
        <td className="px-4 py-4">
          <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700">
            {dealer.Dealer_City || '-'}
          </span>
        </td>
        <td className="px-4 py-4">
          <span className="font-medium text-gray-900">{orderCount}</span>
          <span className="ml-1 text-xs text-gray-400">orders</span>
        </td>
        <td className="px-4 py-4 text-sm text-gray-600">{creditDays} days</td>
        <td className="px-4 py-4 text-right">
          <button
            type="button"
            onClick={onAddBill}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Add Bill
          </button>
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan={6} className="bg-slate-50 px-4 py-5">
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Ledger Bills</h2>
                  <p className="text-xs text-gray-500">
                    {detail?.orders?.length ?? 0} orders available for billing
                  </p>
                </div>
                {isLoadingDetails && (
                  <span className="inline-flex items-center gap-2 text-xs font-medium text-indigo-600">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading orders
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Order
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Bill
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Bill Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Due Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        PDF
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Payment
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {bills.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                          No bills recorded yet. Add a bill to start this dealer ledger.
                        </td>
                      </tr>
                    )}

                    {bills.map((bill) => {
                      const dueDate = addDays(bill.billDate, creditDays)
                      const daysRemaining = getDaysRemaining(bill.billDate, creditDays)
                      const isOverdue = daysRemaining < 0
                      const balance = Math.max(0, bill.billAmount - bill.paidAmount)

                      return (
                        <tr key={bill.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-xs font-semibold text-indigo-700">
                            OM/{new Date().getFullYear()}/{bill.orderNumber}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-gray-900">{formatAmount(bill.billAmount)}</div>
                            <div className="text-xs text-gray-500">GST {bill.gstPercent}%</div>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{formatDate(bill.billDate)}</td>
                          <td className="px-4 py-3 text-gray-600">{formatDateObject(dueDate)}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                isOverdue
                                  ? 'bg-red-50 text-red-700'
                                  : balance === 0
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : 'bg-amber-50 text-amber-700'
                              }`}
                            >
                              {balance === 0
                                ? 'Paid'
                                : isOverdue
                                  ? `${Math.abs(daysRemaining)} days overdue`
                                  : `${daysRemaining} days left`}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {bill.pdfUrl ? (
                              <a
                                href={bill.pdfUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                              >
                                <Download className="h-3.5 w-3.5" />
                                {bill.pdfName}
                              </a>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                                <FileText className="h-3.5 w-3.5" />
                                {bill.pdfName}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => onPayment(bill)}
                              disabled={balance === 0}
                              className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              Record Payment
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
      <div className="w-full max-w-2xl rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}

function FormField({
  label,
  value,
  onChange,
  type = 'text',
  required,
  min,
  step,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
  min?: string
  step?: string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        min={min}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  )
}
