'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { ChevronLeft, AlertCircle } from 'lucide-react'
import DealerInfoCard from '@/components/ledger/DealerInfoCard'
import LedgerSummary from '@/components/ledger/LedgerSummary'
import TransactionTable from '@/components/ledger/TransactionTable'
import PayMoneyModal, { PaymentData } from '@/components/ledger/PayMoneyModal'
import { InvoiceModal } from '@/components/InvoiceModel'

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
  transactionCount: number
  message?: string
}

interface TransactionsResponse {
  success: boolean
  data: Transaction[]
  count: number
  message?: string
}

export default function DealerLedgerPage() {
  const params = useParams()
  const router = useRouter()
  const dealerId = params.dealerId as string

  const [payModalOpen, setPayModalOpen] = useState(false)
  const [payLoading, setPayLoading] = useState(false)
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

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
    error: transactionsError,
    refetch: refetchTransactions,
  } = useQuery<TransactionsResponse>({
    queryKey: ['dealer-transactions', dealerId],
    queryFn: async () => {
      const res = await axios.get(`/api/ledger/${dealerId}/transactions`)
      return res.data
    },
    enabled: !!dealerId,
    staleTime: 5 * 60 * 1000,
  })

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
        await Promise.all([refetchLedger(), refetchTransactions()])
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
  const transactions = transactionsData?.data || []
  const transactionCount = transactionsData?.count || 0

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

      <div className="p-6 max-w-7xl mx-auto">
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
          onPayMoneyClick={() => setPayModalOpen(true)}
        />

        {/* Summary Cards */}
        <LedgerSummary
          totalDebit={summary.totalDebit}
          totalCredit={summary.totalCredit}
          netBalance={summary.netBalance}
          isLoading={isLedgerLoading}
        />

        {/* Transaction Table */}
        <TransactionTable
          transactions={transactions}
          isLoading={isTransactionsLoading}
          count={transactionCount}
          onInvoiceClick={() => setInvoiceModalOpen(true)}
        />
      </div>
    </div>
  )
}
