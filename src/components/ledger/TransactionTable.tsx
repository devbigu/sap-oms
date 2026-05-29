'use client'

import { ExternalLink } from 'lucide-react'

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

interface TransactionTableProps {
  transactions: Transaction[]
  isLoading: boolean
  count: number
  onInvoiceClick?: (invoiceId: string) => void
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function formatAmount(value: number): string {
  if (value === 0 || !value) return '—'
  return `₹${value.toLocaleString('en-IN')}`
}

export default function TransactionTable({
  transactions,
  isLoading,
  count,
  onInvoiceClick,
}: TransactionTableProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Transaction History</h2>
        <p className="text-sm text-gray-500">{count} entries</p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Debit
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Credit
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Narration
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Date
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Invoice
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Mode
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {/* Loading state */}
            {isLoading &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="hover:bg-gray-50 transition-colors">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-6 py-4">
                      <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))}

            {/* Empty state */}
            {!isLoading && transactions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-gray-400 text-sm">
                  No transactions found
                </td>
              </tr>
            )}

            {/* Data rows */}
            {!isLoading &&
              transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                  {/* Debit */}
                  <td className="px-6 py-4">
                    {tx.debit > 0 ? (
                      <span className="font-medium text-red-500">
                        +{formatAmount(tx.debit).replace('₹', '')}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Credit */}
                  <td className="px-6 py-4">
                    {tx.credit > 0 ? (
                      <span className="font-medium text-green-500">
                        +{formatAmount(tx.credit).replace('₹', '')}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Narration */}
                  <td className="px-6 py-4 text-gray-700">
                    {tx.narration || '—'}
                  </td>

                  {/* Date */}
                  <td className="px-6 py-4 text-gray-600 text-xs">
                    {formatDate(tx.date)}
                  </td>

                  {/* Invoice */}
                  <td className="px-6 py-4">
                    {tx.invoice ? (
                      <button
                        onClick={() => onInvoiceClick?.(tx.invoice)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg"
                        title={`View ${tx.invoice}`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {tx.invoice}
                      </button>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>

                  {/* Mode */}
                  <td className="px-6 py-4">
                    {tx.mode ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                        {tx.mode}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
