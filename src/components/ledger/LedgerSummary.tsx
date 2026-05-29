'use client'

interface LedgerSummaryProps {
  totalDebit: number
  totalCredit: number
  netBalance: number
  isLoading: boolean
}

export default function LedgerSummary({
  totalDebit,
  totalCredit,
  netBalance,
  isLoading,
}: LedgerSummaryProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="h-4 w-24 bg-gray-200 rounded animate-pulse mb-3" />
            <div className="h-8 w-32 bg-gray-200 rounded animate-pulse" />
          </div>
        ))}
      </div>
    )
  }

  const stats = [
    {
      label: 'TOTAL DEBIT',
      value: totalDebit,
      color: 'text-red-500',
      prefix: '+',
    },
    {
      label: 'TOTAL CREDIT',
      value: totalCredit,
      color: 'text-green-500',
      prefix: '+',
    },
    {
      label: 'NET BALANCE',
      value: netBalance,
      color: 'text-gray-900',
      prefix: '',
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-white rounded-xl shadow-sm p-6 border border-gray-200"
        >
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            {stat.label}
          </p>
          <p className={`text-2xl font-bold ${stat.color}`}>
            {stat.prefix}₹{stat.value.toLocaleString('en-IN')}
          </p>
        </div>
      ))}
    </div>
  )
}
