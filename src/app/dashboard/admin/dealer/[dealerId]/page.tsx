'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import axios from 'axios'

type StaffOption = {
  staff_id: string
  staff_name: string
  staff_roletype: string
}

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api"
const DEALER_LIST_ROUTE = "/dashboard/admin/dealer/DealerList"

function splitCsv(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean)
  return String(value || "").split(",").map(s => s.trim()).filter(Boolean)
}

function InputField({
  label, value, onChange, type = "text", placeholder, required = true, hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
        {label}
        {required && <span className="text-orange-500 ml-0.5">*</span>}
      </label>
      <input
        required={required}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || label}
        className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
      />
      {hint && <p className="text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}

export default function EditDealerPage() {
  const router = useRouter()
  const params = useParams()
  const dealerId = String(params.dealerId || "")

  const [isLoading,  setIsLoading]  = useState(false)
  const [isSaving,   setIsSaving]   = useState(false)
  const [toastMsg,   setToastMsg]   = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  const [selectedStaffToAdd, setSelectedStaffToAdd] = useState("")

  // Form fields
  const [name,           setName]           = useState("")
  const [email,          setEmail]          = useState("")
  const [number,         setNumber]         = useState("")
  const [city,           setCity]           = useState("")
  const [address,        setAddress]        = useState("")
  const [pincode,        setPincode]        = useState("")
  const [username,       setUsername]       = useState("")
  const [password,       setPassword]       = useState("")
  const [dealercode,     setDealercode]     = useState("")
  const [gst,            setGst]            = useState("")
  const [discount,       setDiscount]       = useState("")
  const [creditdays,     setCreditdays]     = useState("")
  const [annualtarget,   setAnnualtarget]   = useState("")
  const [currentlimit,   setCurrentlimit]   = useState("")
  const [notes,          setNotes]          = useState("")
  const [dealerid,       setDealerid]       = useState("")
  const [assignedStaffIds, setAssignedStaffIds] = useState<string[]>([])
  const [existingStaffNames, setExistingStaffNames] = useState("")

  // Toast auto-dismiss
  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3500)
    return () => clearTimeout(t)
  }, [toastMsg])

  const fetchDealer = async () => {
    if (!dealerId) return
    setIsLoading(true)
    try {
      const res  = await fetch(`${BACKEND_URL}/getdealer?id=${encodeURIComponent(dealerId)}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ type: 'type' }),
      })
      const json = await res.json()
      if (json.status) {
        const d = json.data
        setName(d.Dealer_Name        || "")
        setEmail(d.Dealer_Email       || "")
        setNumber(d.Dealer_Number     || "")
        setCity(d.Dealer_City         || "")
        setPincode(d.Dealer_Pincode   || "")
        setAddress(d.Dealer_Address   || "")
        setUsername(d.Dealer_Username || "")
        setDiscount(d.discount        || "")
        setPassword(d.Dealer_Password || "")
        setDealercode(d.Dealer_Dealercode || "")
        setGst(d.gst                  || "")
        setCreditdays(d.creditdays    || "")
        setNotes(d.Dealer_Notes       || "")
        setDealerid(d.Dealer_Id       || "")
        setAnnualtarget(d.annualtarget || "")
        setCurrentlimit(d.currentlimit || "")
        setExistingStaffNames(d.staffname || "")
        setAssignedStaffIds(splitCsv(d.assignedstaff))
      } else {
        setToastMsg({ text: json.msz || "Failed to load dealer", type: 'error' })
      }
    } catch {
      setToastMsg({ text: "Failed to load dealer data", type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const fetchStaff = async () => {
    try {
      const res  = await fetch(`${BACKEND_URL}/staffassign`)
      const json = await res.json()
      setStaffOptions(json.data || [])
    } catch {
      console.error("Failed to fetch staff")
    }
  }

  useEffect(() => {
    fetchDealer()
    fetchStaff()
  }, [dealerId])

  const handleStaffSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setAssignedStaffIds(Array.from(e.target.selectedOptions, o => o.value))
  }

  // Derive staffname string from current selection (matches what AddDealerForm does)
  const getStaffNames = () =>
    assignedStaffIds
      .map(id => staffOptions.find(s => s.staff_id === id)?.staff_name ?? "")
      .filter(Boolean)
      .join(",") || existingStaffNames

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!assignedStaffIds.length) {
      setToastMsg({ text: "Please assign at least one staff member", type: 'error' })
      return
    }
    const resolvedDealerId = dealerid || dealerId
    if (!resolvedDealerId) {
      setToastMsg({ text: "Missing dealer id", type: 'error' })
      return
    }
    setIsSaving(true)
    try {
      const fd = new FormData()
      fd.append("Dealer_Name",      name)
      fd.append("Dealer_Email",     email)
      fd.append("Dealer_Number",    number)
      fd.append("Dealer_City",      city)
      fd.append("Dealer_Address",   address)
      fd.append("Dealer_Pincode",   pincode)
      fd.append("Dealer_Username",  username)
      fd.append("Dealer_Password",  password)
      fd.append("Dealer_Dealercode", dealercode)
      fd.append("Dealer_Notes",     notes)
      fd.append("assignedstaff",    assignedStaffIds.join(','))
      fd.append("staffname",        getStaffNames())
      fd.append("discount",         discount)
      fd.append("gst",              gst)
      fd.append("creditdays",       creditdays)
      fd.append("annualtarget",     annualtarget)
      fd.append("currentlimit",     currentlimit)
      fd.append("id",               resolvedDealerId)
      fd.append("Dealer_Id",        resolvedDealerId)

      const res = await axios.post(`${BACKEND_URL}/updateDealer`, fd)
      setToastMsg({ text: res.data.msg || "Dealer updated successfully", type: 'success' })
      setTimeout(() => router.push(DEALER_LIST_ROUTE), 700)
    } catch {
      setToastMsg({ text: "Failed to update dealer", type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading dealer data...</p>
        </div>
      </div>
    )
  }

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

      <div className="p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push(DEALER_LIST_ROUTE)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4 transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to Dealer List
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Edit Dealer</h1>
          <p className="text-sm text-gray-500 mt-1">Update dealer information and settings</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-6">

            {/* Basic Info */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">
                Basic Information
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Name"             value={name}    onChange={setName}    placeholder="Full name" />
                <InputField label="Email Address"    value={email}   onChange={setEmail}   type="email" placeholder="dealer@email.com" />
                <InputField label="WhatsApp Number"  value={number}  onChange={setNumber}  type="number" placeholder="10-digit number" />
                <InputField label="City"             value={city}    onChange={setCity}    placeholder="City / Location" />
                <InputField label="Address"          value={address} onChange={setAddress} placeholder="Street address" />
                <InputField label="Pin Code"         value={pincode} onChange={setPincode} type="number" placeholder="6-digit pin code" />
              </div>
            </div>

            {/* Account & Auth */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">
                Account &amp; Credentials
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Dealer Code" value={dealercode} onChange={setDealercode} placeholder="Unique dealer code" />
                <InputField label="Username"    value={username}   onChange={setUsername}   placeholder="Login username" />
                <InputField label="Password"    value={password}   onChange={setPassword}   type="password" placeholder="Set a password" />
                <InputField label="GST No."     value={gst}        onChange={setGst}        placeholder="15-character GST number" />
              </div>
            </div>

            {/* Financial */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">
                Financial Settings
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Discount %"     value={discount}     onChange={setDiscount}     type="number" placeholder="e.g. 10" />
                <InputField label="Credit Days"    value={creditdays}   onChange={setCreditdays}   type="number" placeholder="e.g. 30" />
                <InputField label="Annual Target"  value={annualtarget} onChange={setAnnualtarget} type="number" placeholder="Amount in Rs" />
                <InputField label="Current Limit"  value={currentlimit} onChange={setCurrentlimit} type="number" placeholder="Credit limit in Rs" />
              </div>
            </div>

            {/* Staff Assignment */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">
                Staff Assignment
              </h2>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                  Assign Staff
                  <span className="text-orange-500 ml-0.5">*</span>
                  <span className="ml-2 text-gray-400 normal-case font-normal">(hold Ctrl / Cmd to select multiple)</span>
                </label>
                <div className="mt-2 flex gap-2 items-center">
                  <select
                    value={selectedStaffToAdd}
                    onChange={(e) => setSelectedStaffToAdd(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none"
                  >
                    <option value="">Select staff to add</option>
                    {staffOptions.map(staff => (
                      <option key={staff.staff_id} value={staff.staff_id}>
                        {staff.staff_name} {String(staff.staff_roletype) === "1" ? "(Exe)" : "(Fie-Exe)"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedStaffToAdd) return
                      setAssignedStaffIds(prev => prev.includes(selectedStaffToAdd) ? prev : [...prev, selectedStaffToAdd])
                      setSelectedStaffToAdd("")
                    }}
                    className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
                  >
                    Add
                  </button>
                </div>
                <select
                  multiple
                  value={assignedStaffIds}
                  onChange={handleStaffSelect}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition h-40"
                >
                  {staffOptions.map(staff => (
                    <option key={staff.staff_id} value={staff.staff_id}>
                      {staff.staff_name} {String(staff.staff_roletype) === "1" ? "(Exe)" : "(Fie-Exe)"}
                    </option>
                  ))}
                </select>

                {/* Selected staff chips */}
                {assignedStaffIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {assignedStaffIds.map(sid => {
                      const staff = staffOptions.find(s => s.staff_id === sid)
                      return staff ? (
                        <span key={sid} className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2.5 py-1 rounded-full border border-indigo-100">
                          {staff.staff_name}
                          <button
                            type="button"
                            onClick={() => setAssignedStaffIds(prev => prev.filter(s => s !== sid))}
                            className="text-indigo-400 hover:text-indigo-700 ml-0.5"
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <path d="M18 6 6 18M6 6l12 12"/>
                            </svg>
                          </button>
                        </span>
                      ) : null
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">
                Notes
              </h2>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Internal Notes</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Add any notes about this dealer..."
                  className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-none"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pb-6">
              <button
                type="button"
                onClick={() => router.push(DEALER_LIST_ROUTE)}
                className="px-5 py-2.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-2.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition font-medium"
              >
                {isSaving && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>

          </div>
        </form>
      </div>
    </div>
  )
}
