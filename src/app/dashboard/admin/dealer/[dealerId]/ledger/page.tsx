'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { ChevronLeft, AlertCircle } from 'lucide-react'
import DealerInfoCard from '@/components/ledger/DealerInfoCard'
import LedgerSummary from '@/components/ledger/LedgerSummary'
import AccountBookSummary, { AccountBookStats } from '@/components/ledger/AccountBookSummary'
import TransactionTable from '@/components/ledger/TransactionTable'
import PayMoneyModal, { PaymentData } from '@/components/ledger/PayMoneyModal'
import { InvoiceModal } from '@/components/InvoiceModel'

const TRANSACTIONS_PAGE_SIZE = 10

interface Dealer {
  Dealer_Id: string
  Dealer_Name: string
  Dealer_Email: string
  Dealer_Number: string
  Dealer_Address: string
  Dealer_City: string
  Dealer_Pincode: string
  walletBalance: number
}

interface WalletTransaction {
  id: string
  type: 'credit' | 'debit'
  amount: number
  balanceBefore: number
  balanceAfter: number
  reference?: string
  note?: string
  createdAt?: string | null
}

interface WalletResponse {
  success: boolean
  dealerId: string
  balance: number
  transactions: WalletTransaction[]
  updatedAt?: string | null
}

interface LedgerSummaryData {
  totalDebit: number
  totalCredit: number
  netBalance: number
}

interface Transaction {
  id: string
  debit: number
  credit: number
  narration: string
  date: string
  invoice: string
  mode: string
  type?: string
}

interface DealerLedgerResponse {
  success: boolean
  dealer: Dealer
  summary: LedgerSummaryData
  summaryStats: AccountBookStats
  transactionCount: number
  isLive: boolean
  updatedAt?: string
  message?: string
}

interface TransactionsResponse {
  success: boolean
  data: Transaction[]
  count: number
  page: number
  pageSize: number
  totalPages: number
  hasNextPage: boolean
  hasPreviousPage: boolean
  message?: string
}

export default function DealerLedgerPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const dealerId = params.dealerId as string

  const [payModalOpen, setPayModalOpen] = useState(false)
  const [payLoading, setPayLoading] = useState(false)
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)
  const [walletAdjustOpen, setWalletAdjustOpen] = useState(false)
  const [walletAdjustType, setWalletAdjustType] = useState<'credit' | 'debit'>('credit')
  const [walletAdjustAmount, setWalletAdjustAmount] = useState('')
  const [walletAdjustReference, setWalletAdjustReference] = useState('')
  const [walletAdjustNote, setWalletAdjustNote] = useState('')
  const [walletAdjustLoading, setWalletAdjustLoading] = useState(false)
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [transactionsPage, setTransactionsPage] = useState(1)

  // Fetch dealer info and summary
  const {
    data: ledgerData,
    isLoading: isLedgerLoading,
    error: ledgerError,
    refetch: refetchLedger,
  } = useQuery<DealerLedgerResponse>({
    queryKey: ['dealer-ledger', dealerId],
    queryFn: async () => {
      const res = await axios.get(`/api/ledger/${dealerId}`)
      return res.data
    },
    enabled: !!dealerId,
    staleTime: 5 * 60 * 1000,
  })

  // Fetch transactions
  const {
    data: transactionsData,
    isLoading: isTransactionsLoading,
    isFetching: isTransactionsFetching,
    error: transactionsError,
  } = useQuery<TransactionsResponse>({
    queryKey: ['dealer-transactions', dealerId, transactionsPage],
    queryFn: async () => {
      const res = await axios.get(`/api/ledger/${dealerId}/transactions`, {
        params: { page: transactionsPage, limit: TRANSACTIONS_PAGE_SIZE },
      })
      return res.data
    },
    enabled: !!dealerId,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })

  const {
    data: walletData,
    isLoading: isWalletLoading,
    refetch: refetchWallet,
  } = useQuery<WalletResponse>({
    queryKey: ['dealer-wallet', dealerId],
    queryFn: async () => {
      const res = await axios.get(`/api/wallet/${dealerId}`)
      return res.data
    },
    enabled: !!dealerId,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    setTransactionsPage(1)
  }, [dealerId])

  useEffect(() => {
    if (!dealerId || !transactionsData?.hasNextPage) return

    queryClient.prefetchQuery({
      queryKey: ['dealer-transactions', dealerId, transactionsPage + 1],
      queryFn: async () => {
        const res = await axios.get(`/api/ledger/${dealerId}/transactions`, {
          params: { page: transactionsPage + 1, limit: TRANSACTIONS_PAGE_SIZE },
        })
        return res.data
      },
      staleTime: 5 * 60 * 1000,
    })
  }, [dealerId, queryClient, transactionsData?.hasNextPage, transactionsPage])

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const handlePayMoney = async (data: PaymentData) => {
    setPayLoading(true)
    try {
      const response = await axios.post(`/api/ledger/${dealerId}/pay`, data)
      if (response.data.success) {
        setToast({ text: 'Payment recorded successfully', type: 'success' })
        // Refetch data
        await Promise.all([
          refetchLedger(),
          refetchWallet(),
          queryClient.invalidateQueries({ queryKey: ['dealer-transactions', dealerId] }),
        ])
      }
    } catch (error: any) {
      setToast({
        text: error.response?.data?.message || 'Failed to record payment',
        type: 'error',
      })
    } finally {
      setPayLoading(false)
    }
  }

  const handleWalletAdjust = async () => {
    const amount = Number(walletAdjustAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setToast({ text: 'Enter a valid wallet amount', type: 'error' })
      return
    }

    setWalletAdjustLoading(true)
    try {
      const response = await axios.post(`/api/wallet/${dealerId}/adjust`, {
        type: walletAdjustType,
        amount,
        reference: walletAdjustReference,
        note: walletAdjustNote,
      })
      if (response.data.success) {
        setToast({ text: 'Wallet updated successfully', type: 'success' })
        setWalletAdjustOpen(false)
        setWalletAdjustAmount('')
        setWalletAdjustReference('')
        setWalletAdjustNote('')
        await Promise.all([refetchWallet(), refetchLedger()])
      }
    } catch (error: any) {
      setToast({
        text: error.response?.data?.message || 'Failed to update wallet',
        type: 'error',
      })
    } finally {
      setWalletAdjustLoading(false)
    }
  }

  if (ledgerError) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="p-6 max-w-7xl mx-auto">
          <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-200">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <div>
              <p className="font-semibold text-red-900">Error Loading Ledger</p>
              <p className="text-sm text-red-700 mt-1">
                {(ledgerError as any)?.message || 'Dealer not found'}
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const dealer = ledgerData?.dealer
  const summary = ledgerData?.summary || { totalDebit: 0, totalCredit: 0, netBalance: 0 }
  const summaryStats = ledgerData?.summaryStats
  const isLive = ledgerData?.isLive ?? true
  const transactions = transactionsData?.data || []
  const transactionCount = transactionsData?.count || 0
  const transactionPage = transactionsData?.page || transactionsPage
  const transactionPageSize = transactionsData?.pageSize || TRANSACTIONS_PAGE_SIZE
  const transactionTotalPages = transactionsData?.totalPages || 1

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 text-sm px-4 py-3 rounded-lg shadow-lg transition-all flex items-center gap-2 ${
            toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.type === 'success' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4m0 4h.01" />
            </svg>
          )}
          {toast.text}
        </div>
      )}

      {/* Pay Money Modal */}
      <PayMoneyModal
        isOpen={payModalOpen}
        onClose={() => setPayModalOpen(false)}
        onSubmit={handlePayMoney}
        dealerName={dealer?.Dealer_Name || 'Dealer'}
        isLoading={payLoading}
      />

      {/* Invoice Modal */}
      <InvoiceModal
        isOpen={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        dealerId={dealerId}
      />

      {walletAdjustOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h3 className="text-base font-semibold text-gray-900">Adjust Wallet</h3>
              <button
                type="button"
                onClick={() => setWalletAdjustOpen(false)}
                className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              >
                X
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="grid grid-cols-2 gap-2">
                {(['credit', 'debit'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setWalletAdjustType(mode)}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold capitalize transition ${
                      walletAdjustType === mode
                        ? mode === 'credit'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-rose-300 bg-rose-50 text-rose-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Amount</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={walletAdjustAmount}
                  onChange={(e) => setWalletAdjustAmount(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Reference</span>
                <input
                  type="text"
                  value={walletAdjustReference}
                  onChange={(e) => setWalletAdjustReference(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">Note</span>
                <textarea
                  value={walletAdjustNote}
                  onChange={(e) => setWalletAdjustNote(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWalletAdjustOpen(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleWalletAdjust}
                  disabled={walletAdjustLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                >
                  {walletAdjustLoading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 max-w-7xl mx-auto">
        {!isLive && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            Showing offline cached ledger data. Connection to main billing system is temporarily unavailable.
          </div>
        )}

        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors mb-6"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Dealers
        </button>

        {/* Dealer Info Card */}
        <DealerInfoCard
          dealer={dealer || null}
          isLoading={isLedgerLoading}
          walletBalance={walletData?.balance}
          walletTransactions={walletData?.transactions}
          walletLoading={isWalletLoading}
          onPayMoneyClick={() => setPayModalOpen(true)}
          canAdjustWallet
          onAdjustWalletClick={() => setWalletAdjustOpen(true)}
        />

        {/* Summary Cards */}
        <LedgerSummary
          totalDebit={summary.totalDebit}
          totalCredit={summary.totalCredit}
          netBalance={summary.netBalance}
          isLoading={isLedgerLoading}
        />

        <AccountBookSummary
          stats={summaryStats}
          isLoading={isLedgerLoading}
        />

        {/* Transaction Table */}
        <TransactionTable
          transactions={transactions}
          isLoading={isTransactionsLoading}
          isFetching={isTransactionsFetching}
          count={transactionCount}
          page={transactionPage}
          pageSize={transactionPageSize}
          totalPages={transactionTotalPages}
          hasNextPage={transactionsData?.hasNextPage}
          hasPreviousPage={transactionsData?.hasPreviousPage}
          onPageChange={setTransactionsPage}
          onInvoiceClick={() => setInvoiceModalOpen(true)}
        />
      </div>
    </div>
  )
}
