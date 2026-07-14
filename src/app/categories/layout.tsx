import type { ReactNode } from "react";

import ProtectedStorefrontLayout from "@/components/layout/ProtectedStorefrontLayout";

export default function CategoriesLayout({ children }: { children: ReactNode }) {
  return <ProtectedStorefrontLayout>{children}</ProtectedStorefrontLayout>;
}
