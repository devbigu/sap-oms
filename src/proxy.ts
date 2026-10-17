import { NextResponse, type NextRequest } from "next/server"
import { MAINTENANCE } from "@/lib/maintenance"

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (!MAINTENANCE || pathname === "/auth/login") return NextResponse.next()
  if (pathname.startsWith("/api/")) return new NextResponse("Under maintenance", { status: 503 })
  return NextResponse.redirect(new URL("/auth/login", request.url))
}

// Skip Next internals and static files (anything with an extension) so the notice's logo/CSS still load.
export const config = {
  matcher: ["/((?!_next/|.*\\..*).*)"],
}
