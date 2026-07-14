"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"

import { broadcastAuthChange, clearStoredAuthData } from "@/lib/auth/client"
import { getDefaultRouteForRole, type ClientAuthRole } from "@/lib/auth/client"
import { isRoleAllowed } from "@/lib/auth/routePolicy"
import type { PublicAppSession } from "@/lib/auth/session"

const ROLE_OPTIONS = [
  { label: "Staff", value: "1" },
  { label: "Dealer", value: "2" },
  { label: "Admin", value: "3" },
]

const LOGO_SRC = "/omsons_logo.jpeg"

function getRoleFromLoginResponse(data: { session?: { role?: unknown } | null } | null, roletype: string): ClientAuthRole {
  const responseRole = data?.session?.role
  if (responseRole === "admin" || responseRole === "staff" || responseRole === "dealer" || responseRole === "accountant") {
    return responseRole
  }
  if (roletype === "3") return "admin"
  if (roletype === "2") return "dealer"
  return "staff"
}

function mergeSessionIntoStoredUserData(
  userData: Record<string, unknown>,
  session: PublicAppSession | null | undefined,
  resolvedRole: ClientAuthRole,
) {
  if (!session) return userData

  if (resolvedRole === "admin") {
    return {
      ...userData,
      id: session.adminId ?? session.userId ?? userData.id ?? userData.admin_id ?? userData.Admin_Id,
      admin_id: session.adminId ?? session.userId ?? userData.admin_id ?? userData.id,
      email: session.email ?? userData.email,
      name: session.name ?? userData.name ?? userData.username,
      username: userData.username ?? session.name ?? session.email,
      staff_id: session.staffId ?? userData.staff_id,
      staff_name: session.staffName ?? userData.staff_name,
      staff_roletype: session.staffRoleType ?? userData.staff_roletype ?? "0",
      staff_location: session.staffLocation ?? userData.staff_location,
      staff_designation: session.staffDesignation ?? userData.staff_designation,
    }
  }

  if (resolvedRole === "staff") {
    return {
      ...userData,
      staff_id: session.staffId ?? session.userId ?? userData.staff_id,
      staff_name: session.staffName ?? session.name ?? userData.staff_name,
      staff_roletype: session.staffRoleType ?? userData.staff_roletype ?? "1",
      staff_location: session.staffLocation ?? userData.staff_location,
      staff_designation: session.staffDesignation ?? userData.staff_designation,
      staff_email: session.email ?? userData.staff_email ?? userData.email,
      email: session.email ?? userData.email,
      name: session.name ?? userData.name,
    }
  }

  if (resolvedRole === "dealer") {
    return {
      ...userData,
      Dealer_Id: session.dealerId ?? session.userId ?? userData.Dealer_Id,
      Dealer_Name: session.dealerName ?? session.name ?? userData.Dealer_Name,
      Dealer_City: session.dealerCity ?? userData.Dealer_City,
      Dealer_Dealercode: session.dealerCode ?? userData.Dealer_Dealercode,
      Dealer_Email: session.email ?? userData.Dealer_Email ?? userData.email,
      Dealer_Number: session.phone ?? userData.Dealer_Number,
    }
  }

  return userData
}

export default function Login() {
  const router = useRouter()

  const [showNotice, setShowNotice] = useState(true)
  const [roletype, setRoletype] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!showNotice) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowNotice(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [showNotice])

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError("")

    if (!email || !password || !roletype) {
      setError("All fields are required")
      return
    }

    try {
      setLoading(true)

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, roletype }),
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        setError(data?.message || "Login failed")
        return
      }

      const userData = (data.data && typeof data.data === "object" ? data.data : { email, role: roletype }) as Record<string, unknown>
      const resolvedRole = getRoleFromLoginResponse(data, roletype)
      const storedUserData = mergeSessionIntoStoredUserData(userData, data.session, resolvedRole)
      clearStoredAuthData(window.localStorage)
      localStorage.setItem("status", "true")
      localStorage.setItem("roletype", roletype)
      if (roletype === "1") {
        localStorage.setItem("staffData", JSON.stringify(storedUserData))
      }
      if (roletype === "2") {
        localStorage.setItem("UserData", JSON.stringify(storedUserData))
      }
      if (roletype === "3") {
        localStorage.setItem("AdminData", JSON.stringify(storedUserData))
        localStorage.setItem("admin", JSON.stringify(storedUserData))
      }
      broadcastAuthChange()

      setEmail("")
      setPassword("")
      setRoletype("")

      const nextPath =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("next")
          : null
      const fallbackRoute =
        typeof data?.redirectTo === "string" && data.redirectTo.startsWith("/")
          ? data.redirectTo
          : getDefaultRouteForRole(resolvedRole)
      const safeNextPath =
        typeof nextPath === "string" &&
        nextPath.startsWith("/") &&
        isRoleAllowed(nextPath, resolvedRole)
          ? nextPath
          : null
      router.push(safeNextPath || fallbackRoute)
    } catch (err: unknown) {
      console.error("Login error:", err)
      setError(err instanceof Error ? err.message : "Server error")
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
                    src={LOGO_SRC}
                    alt="Omsons Logo"
                    width={34}
                    height={34}
                    className="h-9 w-9 rounded-full bg-[#1d4ed8] object-contain p-1"
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
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      className="h-10 w-full rounded-full border border-slate-200 bg-white px-5 pr-12 text-[13px] text-slate-900 shadow-sm outline-none transition placeholder:text-slate-300 focus:border-[#5b3ff2] focus:ring-4 focus:ring-[#5b3ff2]/10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((visible) => !visible)}
                      className="absolute right-4 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
                      aria-label={showPw ? "Hide password" : "Show password"}
                      title={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
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
          <div className="relative hidden bg-[#0150C6] lg:block">
            <img
              src="/login2.png"
              alt="Omsons laboratory glassware"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>

        </section>
      </div>

      {showNotice && (
        <div>
          <div
  className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-md"
  onClick={() => setShowNotice(false)}
  aria-hidden="true"
>
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="testing-phase-title"
    className="relative w-full max-w-[460px] rounded-3xl bg-zinc-100 p-6 text-center text-slate-900 shadow-[0_30px_80px_rgba(15,23,42,0.28)] ring-1 ring-black/5 sm:p-7"
    onClick={(event) => event.stopPropagation()}
  >
    {/* Close button */}
    <button
      type="button"
      onClick={() => setShowNotice(false)}
      aria-label="Close"
      className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-4 focus:ring-slate-100"
    >
    </button>

    {/* Icon */}
    <div className="mx-auto flex h-19 w-19 items-center justify-center rounded-full ">
      <img
        src={LOGO_SRC}
        alt="Omsons Logo"
        className="h-19 w-19 object-contain"
      />
    </div>

    <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-black">
Welcome to the Omsons Partner Portal
    </p>

    <p
      id="testing-phase-title"
      className="mt-2 text-lg font-semibold tracking-[-0.01em] text-slate-950 sm:text-xl"
    >
      Thank You for Being With Us
    </p>

    <p className="mt-3 text-sm leading-6 text-slate-600 sm:text-[15px]">
     We appreciate your continued trust in Omsons. Our new Order Management System is designed to provide a seamless, transparent, and efficient ordering experience, empowering you to serve your customers with confidence.
    </p>

    <div className="mt-5 rounded-2xl  px-4 py-3 text-sm leading-6">
Together, we build success.    </div>

    <div className="mt-6 flex justify-center">
      {/* <button
        type="button"
        onClick={() => setShowNotice(false)}
        className="inline-flex h-11 w-full items-center justify-center rounded-full bg-amber-500 px-5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(245,158,11,0.28)] transition hover:bg-amber-600 focus:outline-none focus:ring-4 focus:ring-amber-200 sm:w-auto sm:px-8"
      >
        Let's Get Started
      </button> */}
    </div>
  </div>
</div>
        </div>
      )}
    </main>
  )
}
