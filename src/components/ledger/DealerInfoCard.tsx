'use client'

import { User, Mail, Phone, MapPin, Wallet } from 'lucide-react'

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

interface DealerInfoCardProps {
  dealer: Dealer | null
  isLoading: boolean
  onPayMoneyClick: () => void
}

export default function DealerInfoCard({
  dealer,
  isLoading,
  onPayMoneyClick,
}: DealerInfoCardProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1">
            <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-3" />
            <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
          </div>
          <div className="h-10 w-24 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-200 rounded animate-pulse" />
              <div className="flex-1">
                <div className="h-4 w-20 bg-gray-200 rounded animate-pulse mb-2" />
                <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!dealer) {
    return null
  }

  const walletBalance = dealer.walletBalance || 0

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-gray-200">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Ledger Account
          </p>
          <h1 className="text-2xl font-bold text-gray-900">{dealer.Dealer_Name}</h1>
        </div>
        <button
          onClick={onPayMoneyClick}
          className="px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          Pay Money
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Mobile */}
        {dealer.Dealer_Number && (
          <div className="flex items-start gap-3">
            <Phone className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Mobile
              </p>
              <p className="text-sm font-medium text-gray-900 mt-1">
                {dealer.Dealer_Number}
              </p>
            </div>
          </div>
        )}

        {/* Email */}
        {dealer.Dealer_Email && (
          <div className="flex items-start gap-3">
            <Mail className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Email
              </p>
              <p className="text-sm font-medium text-gray-900 mt-1 truncate">
                {dealer.Dealer_Email}
              </p>
            </div>
          </div>
        )}

        {/* Address */}
        {dealer.Dealer_Address && (
          <div className="flex items-start gap-3">
            <MapPin className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Address
              </p>
              <p className="text-sm font-medium text-gray-900 mt-1">
                {dealer.Dealer_Address}, {dealer.Dealer_City} {dealer.Dealer_Pincode}
              </p>
            </div>
          </div>
        )}

        {/* Wallet Balance */}
        <div className="flex items-start gap-3">
          <Wallet className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Wallet Balance
            </p>
            <p className="text-sm font-medium text-gray-900 mt-1">
              <span className="inline-flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />₹
                {walletBalance.toLocaleString('en-IN')}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
