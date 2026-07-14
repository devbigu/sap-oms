"use client";

import type { ReactNode } from "react";
import { Suspense } from "react";

import ClientRouteGuard from "@/components/auth/ClientRouteGuard";
import Footer from "@/components/Footer";
import Header from "@/components/Header";

type ProtectedStorefrontLayoutProps = {
  children: ReactNode;
  includeFooter?: boolean;
};

function RouteGuardFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3 text-sm text-slate-500">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
        <span>Checking access...</span>
      </div>
    </div>
  );
}

export default function ProtectedStorefrontLayout({
  children,
  includeFooter = true,
}: ProtectedStorefrontLayoutProps) {
  return (
    <Suspense fallback={<RouteGuardFallback />}>
      <ClientRouteGuard>
        <div className="antialiased">
          <div className="sticky top-0 z-50">
            <Header />
          </div>
          {children}
          {includeFooter ? <Footer /> : null}
        </div>
      </ClientRouteGuard>
    </Suspense>
  );
}
