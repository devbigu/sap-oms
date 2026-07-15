"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearAuthStorage, canAccessRoute, getRoleHome, LOGIN_ROUTE } from "@/lib/roleAccess";
import { useAuthSession } from "@/hooks/useAuthSession";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
    </div>
  );
}

export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, session } = useAuthSession();

  const allowed =
    !loading &&
    session?.status === "authenticated" &&
    canAccessRoute(session.role, pathname);

  useEffect(() => {
    if (loading || !session) return;

    if (session.status !== "authenticated") {
      if (session.reason !== "missing") clearAuthStorage(localStorage);
      router.replace(LOGIN_ROUTE);
      return;
    }

    if (!canAccessRoute(session.role, pathname)) {
      const home = getRoleHome(session.role);
      router.replace(home === pathname ? LOGIN_ROUTE : home);
    }
  }, [loading, pathname, router, session]);

  if (!allowed) return <LoadingScreen />;

  return <>{children}</>;
}
