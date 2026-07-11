import { Suspense } from "react";
import SearchPageClient from "@/components/search/SearchPageClient";

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <SearchPageClient />
    </Suspense>
  );
}
