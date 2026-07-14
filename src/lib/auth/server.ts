import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  decodeSessionToken,
  encodeSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  type AppSession,
  type SessionRole,
} from "@/lib/auth/session";

function getSessionSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing JWT_SECRET for session signing");
  }
  return secret;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function getSessionFromCookieValue(value: string | undefined) {
  if (!value) return null;

  try {
    return decodeSessionToken(value, getSessionSecret());
  } catch (error) {
    console.error("[auth session decode]", error);
    return null;
  }
}

export function getRequestSession(request: Pick<NextRequest, "cookies">) {
  return getSessionFromCookieValue(request.cookies.get(SESSION_COOKIE_NAME)?.value);
}

export async function getServerSession() {
  const store = await cookies();
  return getSessionFromCookieValue(store.get(SESSION_COOKIE_NAME)?.value);
}

export function setSessionCookie(response: NextResponse, session: AppSession) {
  response.cookies.set(
    SESSION_COOKIE_NAME,
    encodeSessionToken(session, getSessionSecret()),
    cookieOptions(),
  );
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...cookieOptions(),
    maxAge: 0,
  });
  return response;
}

export function isRoleAllowed(session: AppSession | null, roles?: SessionRole[]) {
  if (!session) return false;
  if (!roles || roles.length === 0) return true;
  return roles.includes(session.role);
}

export function requireApiSession(
  request: NextRequest,
  options?: {
    roles?: SessionRole[];
    unauthenticatedMessage?: string;
    unauthorizedMessage?: string;
  },
) {
  const session = getRequestSession(request);
  if (!session) {
    return NextResponse.json(
      { success: false, message: options?.unauthenticatedMessage ?? "Authentication required" },
      { status: 401 },
    );
  }

  if (!isRoleAllowed(session, options?.roles)) {
    return NextResponse.json(
      { success: false, message: options?.unauthorizedMessage ?? "You are not authorized for this action" },
      { status: 403 },
    );
  }

  return session;
}

export function getDefaultRouteForSession(session: AppSession) {
  if (session.role === "dealer") return "/home";
  if (session.role === "staff") return "/dashboard/staff";
  if (session.role === "accountant") return "/dashboard/accountant";
  return "/dashboard/admin";
}

export function canAccessDealerScopedResource(session: AppSession, dealerId: string) {
  if (!dealerId) return false;
  if (session.role === "admin" || session.role === "staff" || session.role === "accountant") {
    return true;
  }
  return session.role === "dealer" && session.dealerId === dealerId;
}
