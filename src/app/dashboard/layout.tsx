"use client";

import ProtectedWorkspaceShell from "@/components/layout/ProtectedWorkspaceShell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedWorkspaceShell fallbackTitle="Dashboard" preloadLedger>
      {children}
    </ProtectedWorkspaceShell>
  );
}
