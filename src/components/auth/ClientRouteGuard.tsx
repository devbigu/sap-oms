"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useAuthSession } from "@/hooks/useAuthSession";
import { buildLoginRedirect, getRouteAccessPolicy, getUnauthorizedRedirect, isRoleAllowed } from "@/lib/auth/routePolicy";

function GuardLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3 text-sm text-slate-500">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
        <span>Checking access...</span>
      </div>
    </div>
  );
}

export default function ClientRouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const router = useRouter();
  const { session, loading, status } = useAuthSession();

  const policy = useMemo(() => getRouteAccessPolicy(pathname), [pathname]);
  const search = searchParams.toString();
  const nextSearch = search ? `?${search}` : "";
  const roleAllowed = session ? isRoleAllowed(pathname, session.role) : false;
  const shouldRedirectHome = Boolean(session && policy.redirectAuthenticatedToDefault);

  useEffect(() => {
    if (!policy.requiresAuth || loading) return;

    if (!session) {
      router.replace(buildLoginRedirect(pathname, nextSearch));
      return;
    }

    if (policy.redirectAuthenticatedToDefault) {
      router.replace(getUnauthorizedRedirect(session, pathname));
      return;
    }

    if (!roleAllowed) {
      router.replace(getUnauthorizedRedirect(session, pathname));
    }
  }, [
    loading,
    nextSearch,
    pathname,
    policy.redirectAuthenticatedToDefault,
    policy.requiresAuth,
    roleAllowed,
    router,
    session,
    status,
  ]);

  if (!policy.requiresAuth) {
    return <>{children}</>;
  }

  if (loading || !session || shouldRedirectHome || !roleAllowed) {
    return <GuardLoadingScreen />;
  }

  return <>{children}</>;
}
