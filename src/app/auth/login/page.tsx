"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import axios from "axios"

const ROLE_OPTIONS = [
  { label: "Staff", value: "1" },
  { label: "Dealer", value: "2" },
  { label: "Admin", value: "3" },
]

const BACKEND_URL = "https://mirisoft.co.in/sas/dealerapi/login/login_verify"

export default function Login() {
  const router = useRouter()

  const [roletype, setRoletype] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError("")

    if (!email || !password || !roletype) {
      setError("All fields are required")
      return
    }

    if (!BACKEND_URL) {
      setError("Backend URL is not configured")
      return
    }

    try {
      setLoading(true)

      const formData = new FormData()
      formData.append("email", email)
      formData.append("password", password)
      formData.append("roletype", roletype)

      const res = await axios.post(`${BACKEND_URL}`, formData)
      const data = res.data

      if (data?.status) {
        const userData = data.data || { email, role: roletype }

        localStorage.setItem("status", "true")
        localStorage.setItem("UserData", JSON.stringify(userData))
        localStorage.setItem("roletype", roletype)
        if (roletype === "3") {
          localStorage.setItem("AdminData", JSON.stringify(userData))
        }

        setEmail("")
        setPassword("")
        setRoletype("")

        if (roletype === "1") router.push("/dashboard/staff")
        else if (roletype === "2") router.push("/home")
        else if (roletype === "3") router.push("/dashboard/admin")
      } else {
        setError(data?.msg || "Login failed")
      }
    } catch (err: unknown) {
      console.error("Login error:", err)

      let backendMsg: unknown = "Server error"

      if (axios.isAxiosError(err)) {
        const responseData = err.response?.data
        backendMsg =
          responseData &&
          typeof responseData === "object" &&
          "msg" in responseData
            ? responseData.msg
            : responseData || err.message
      } else if (err instanceof Error) {
        backendMsg = err.message
      }

      setError(typeof backendMsg === "string" ? backendMsg : "Server error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="h-screen overflow-hidden text-slate-950">
      <div className="flex h-full w-full">
        <section className="grid w-full overflow-hidden bg-white lg:grid-cols-[0.86fr_1.14fr]">

          {/* ── Form panel ─────────────────────────────────────────────── */}
          <form
            className="flex min-h-0 flex-col justify-center p-0"
            onSubmit={handleLogin}
          >
            <div className="mx-auto w-full max-w-[330px] px-8">

              {/* Header */}
              <div className="mb-4">
                <div className="mb-3 flex items-center gap-3">
                  <img
                    src="https://omsonslabs.com/wp-content/uploads/elementor/thumbs/Logo-White-rjr8rdx3pqxz9p6ypfegb07hgtpvj3g22mnujlpa0w.png"
                    alt="Omsons Logo"
                    width={34}
                    height={34}
                    className="rounded-full bg-[#1d4ed8] p-1"
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Omsons</p>
                    <p className="text-xs text-slate-400">Dealer network</p>
                  </div>
                </div>
                <h1 className="text-[26px] font-black leading-tight tracking-[-0.01em] text-slate-950">
                  Login
                </h1>
                <p className="mt-1 text-[13px] text-slate-500">
                  Sign in to manage orders, products, and dispatches.
                </p>
              </div>

              {/* Fields */}
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Role</span>
                  <div className="relative">
                    <select
                      value={roletype}
                      onChange={(e) => setRoletype(e.target.value)}
                      className="h-10 w-full appearance-none rounded-full border border-slate-200 bg-white px-5 pr-10 text-[13px] font-medium text-slate-900 shadow-sm outline-none transition focus:border-[#5b3ff2] focus:ring-4 focus:ring-[#5b3ff2]/10"
                    >
                      <option value="" disabled>Select your role</option>
                      {ROLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value} className="text-slate-900">
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-slate-400">
                      <svg width="12" height="12" viewBox="0 0 12 12">
                        <path
                          d="M2 4l4 4 4-4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        />
                      </svg>
                    </span>
                  </div>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Email</span>
                  <input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-10 w-full rounded-full border border-slate-200 bg-white px-5 text-[13px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-300 focus:border-[#5b3ff2] focus:ring-4 focus:ring-[#5b3ff2]/10"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">Password</span>
                  <input
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10 w-full rounded-full border border-slate-200 bg-white px-5 text-[13px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-300 focus:border-[#5b3ff2] focus:ring-4 focus:ring-[#5b3ff2]/10"
                  />
                </label>
              </div>

              {/* Forgot password */}
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[#4f35dc] hover:text-[#321fbd]"
                >
                  Forgot Password?
                </button>
              </div>

              {/* Error message */}
              {error && (
                <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-[12px] font-semibold text-red-600">
                  {error}
                </p>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="mt-4 h-10 w-full rounded-full bg-[#593df4] px-4 text-[13px] font-bold text-white shadow-[0_14px_28px_rgba(89,61,244,0.28)] transition hover:-translate-y-0.5 hover:bg-[#4b31de] active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? "Signing in..." : "Login"}
              </button>

              {/* Accountant portal — inline row */}
              <div className="mt-4 flex items-center justify-center gap-3">
                <p className="text-[11px] text-slate-400">Signing in as an accountant?</p>
                <button
                  type="button"
                  onClick={() => router.push("/auth/accountant-login")}
                  className="inline-flex h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-[11px] font-semibold text-slate-600 transition hover:border-[#593df4] hover:text-[#593df4]"
                >
                  Accountant portal
                </button>
              </div>

              {/* Footer */}
              <p className="mt-4 text-center text-[11px] text-slate-300">
                ©2026 Omsons. All rights reserved.
              </p>
            </div>
          </form>

          {/* ── Image panel ────────────────────────────────────────────── */}
          {/*
            overflow-hidden on the section clips the image.
            absolute inset-0 makes the img fill the div exactly.
            object-cover + object-left-center covers without distortion,
            cropping from the right side while keeping the subject visible.
          */}
          <div className="relative hidden bg-[##0150C6] lg:block">
            <img
              src="/login2.png"
              alt="Omsons laboratory glassware"
              className="absolute inset-0 h-full w-full "
            />
          </div>

        </section>
      </div>
    </main>
  )
}