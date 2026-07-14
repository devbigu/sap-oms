import { NextRequest, NextResponse } from "next/server";

import { setSessionCookie, getDefaultRouteForSession } from "@/lib/auth/server";
import { buildPhpUserSession, toPublicSession } from "@/lib/auth/session";
import { getPhpBaseUrl } from "@/lib/phpBackend";
import { getDb, isMongoDependencyError } from "@/lib/mongodb";
import { normalizeDealerStatus } from "@/lib/dealerStatus";

export const runtime = "nodejs";

type LoginPayload = {
  status?: boolean;
  msg?: string;
  message?: string;
  data?: Record<string, unknown>;
};

class LoginRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LoginRouteError";
    this.status = status;
  }
}

function safeText(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function tryParseJsonPayload(text: string) {
  try {
    return JSON.parse(text) as LoginPayload;
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as LoginPayload;
    }
    throw new LoginRouteError(502, "PHP login returned an unreadable response");
  }
}

async function parseLoginResponse(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new LoginRouteError(502, `PHP login failed with ${response.status}`);
  }
  if (/^\s*</.test(text)) {
    throw new LoginRouteError(502, "PHP login returned HTML instead of JSON");
  }

  return tryParseJsonPayload(text);
}

async function getDealerStatus(dealerId: string) {
  const db = await getDb();
  const doc = await db.collection("dealer_statuses").findOne({ dealerId });
  return normalizeDealerStatus(doc?.status);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const email = safeText(body?.email, 240);
    const password = safeText(body?.password, 240);
    const roletype = safeText(body?.roletype, 20);

    if (!email || !password || !roletype) {
      return NextResponse.json(
        { success: false, message: "Email, password, and role are required" },
        { status: 400 },
      );
    }

    const formData = new FormData();
    formData.append("email", email);
    formData.append("password", password);
    formData.append("roletype", roletype);

    const payload = await parseLoginResponse(
      await fetch(`${getPhpBaseUrl()}/login/login_verify`, {
        method: "POST",
        body: formData,
        cache: "no-store",
      }),
    );

    if (!payload.status || !payload.data || typeof payload.data !== "object") {
      return NextResponse.json(
        { success: false, message: payload.msg || payload.message || "Login failed" },
        { status: 401 },
      );
    }

    const session = buildPhpUserSession(payload.data, roletype);
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Could not determine a valid account role for this login" },
        { status: 403 },
      );
    }

    if (session.role === "dealer" && session.dealerId) {
      try {
        if ((await getDealerStatus(session.dealerId)) === "inactive") {
          return NextResponse.json(
            { success: false, message: "This dealer account is inactive. Please contact the administrator." },
            { status: 403 },
          );
        }
      } catch (error) {
        if (isMongoDependencyError(error)) {
          console.warn("[POST /api/auth/login] Dealer status verification unavailable, allowing login", error);
        } else {
          throw error;
        }
      }
    }

    const response = NextResponse.json({
      success: true,
      data: payload.data,
      session: toPublicSession(session),
      redirectTo: getDefaultRouteForSession(session),
    });

    return setSessionCookie(response, session);
  } catch (error) {
    console.error("[POST /api/auth/login]", error);
    if (error instanceof LoginRouteError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Login failed" },
      { status: 500 },
    );
  }
}
