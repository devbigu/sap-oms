"use client";

import ProtectedWorkspaceShell from "@/components/layout/ProtectedWorkspaceShell";

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedWorkspaceShell fallbackTitle="Orders">
      {children}
    </ProtectedWorkspaceShell>
  );
}
