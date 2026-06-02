'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import axios from 'axios'

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/api"
const STAFF_LIST_ROUTE = "/dashboard/admin/staff/stafflist"

function InputField({
  label, value, onChange, type = "text", placeholder, required = true,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
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
    </div>
  )
}

export default function EditStaffPage() {
  const router = useRouter()
  const params = useParams()
  const id = String(params.id || "")

  const [isLoading, setIsLoading] = useState(false)
  const [isSaving,  setIsSaving]  = useState(false)
  const [toastMsg,  setToastMsg]  = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const [staffid,     setStaffid]     = useState("")
  const [name,        setName]        = useState("")
  const [designation, setDesignation] = useState("")
  const [location,    setLocation]    = useState("")
  const [email,       setEmail]       = useState("")
  const [password,    setPassword]    = useState("")
  const [username,    setUsername]    = useState("")
  const [role,        setRole]        = useState("")

  // Toast auto-dismiss
  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3500)
    return () => clearTimeout(t)
  }, [toastMsg])

  useEffect(() => {
    if (!id) return
    const fetchStaff = async () => {
      setIsLoading(true)
      try {
        const res  = await fetch(`${BACKEND_URL}/getstaff?id=${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ type: 'type' }),
        })
        const json = await res.json()
        if (json.status) {
          const d = json.data
          setName(d.staff_name         || "")
          setEmail(d.staff_email        || "")
          setDesignation(d.staff_designation || "")
          setPassword(d.staff_password  || "")
          setLocation(d.staff_location  || "")
          setUsername(d.staff_username  || "")
          setRole(d.staff_roletype      || "")
          setStaffid(d.staff_id         || "")
        } else {
          setToastMsg({ text: json.msz || "Failed to load staff", type: 'error' })
        }
      } catch {
        setToastMsg({ text: "Failed to load staff data", type: 'error' })
      } finally {
        setIsLoading(false)
      }
    }
    fetchStaff()
  }, [id])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const resolvedStaffId = staffid || id
    if (!resolvedStaffId) {
      setToastMsg({ text: "Missing staff id", type: 'error' })
      return
    }
    setIsSaving(true)
    try {
      const fd = new FormData()
      fd.append("staff_name",        name)
      fd.append("staff_designation", designation)
      fd.append("staff_email",       email)
      fd.append("staff_location",    location)
      fd.append("staff_password",    password)
      fd.append("staff_username",    username)
      fd.append("staff_roletype",    role)
      fd.append("staff_id",          resolvedStaffId)

      const res = await axios.post(`${BACKEND_URL}/editstaff`, fd)
      setToastMsg({ text: res.data.msg || "Staff updated successfully", type: 'success' })
      setTimeout(() => router.push(STAFF_LIST_ROUTE), 700)
    } catch {
      setToastMsg({ text: "Failed to update staff", type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading staff data...</p>
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

      <div className="p-6 max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push(STAFF_LIST_ROUTE)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4 transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to Staff List
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Edit Staff</h1>
          <p className="text-sm text-gray-500 mt-1">Update staff member information</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-6">

            {/* Personal Info */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">
                Personal Information
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Full Name"   value={name}        onChange={setName}        placeholder="Enter full name" />
                <InputField label="Designation" value={designation} onChange={setDesignation} placeholder="e.g. Sales Manager" />
                <InputField label="Email"       value={email}       onChange={setEmail}       type="email" placeholder="staff@company.com" />
                <InputField label="Location"    value={location}    onChange={setLocation}    placeholder="City / Branch" />
              </div>
            </div>

            {/* Account & Auth */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-5 pb-3 border-b border-gray-100">
                Account &amp; Credentials
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <InputField label="Username" value={username} onChange={setUsername} placeholder="Login username" required={false} />
                <InputField label="Password" value={password} onChange={setPassword} type="password" placeholder="Update password" />

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                    Role Type
                    <span className="text-orange-500 ml-0.5">*</span>
                  </label>
                  <select
                    required
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                  >
                    <option value="" disabled>Select a role</option>
                    <option value="1">Executive</option>
                    <option value="2">Field Executive</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pb-6">
              <button
                type="button"
                onClick={() => router.push(STAFF_LIST_ROUTE)}
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
