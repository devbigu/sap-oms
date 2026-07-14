"use client";

import ProtectedWorkspaceShell from "@/components/layout/ProtectedWorkspaceShell";

export default function PagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedWorkspaceShell fallbackTitle="Workspace">
      {children}
    </ProtectedWorkspaceShell>
  );
}
