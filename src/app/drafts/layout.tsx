import type { ReactNode } from "react";

import ProtectedStorefrontLayout from "@/components/layout/ProtectedStorefrontLayout";

export default function DraftsLayout({ children }: { children: ReactNode }) {
  return <ProtectedStorefrontLayout includeFooter={false}>{children}</ProtectedStorefrontLayout>;
}
