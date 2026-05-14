"use client";

// app/dashboard/page.tsx
import { useState, useEffect } from "react";
import TermsModal from "@/components/TermsModal";

// In a real app, pull this from your auth session (next-auth, clerk, etc.)
const MOCK_USER = {
  id: "usr_4821",
  name: "Alex Johnson",
  email: "alex.johnson@example.com",
};

export default function DashboardPage() {
  const [showTerms, setShowTerms] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check localStorage — show modal only if user hasn't accepted yet
    const accepted = localStorage.getItem(`terms_accepted_${MOCK_USER.id}`);
    setShowTerms(!accepted);
    setLoading(false);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      {/* Terms modal blocks all interaction until accepted */}
      {showTerms && (
        <TermsModal
          userId={MOCK_USER.id}
          userName={MOCK_USER.name}
          email={MOCK_USER.email}
          onAccepted={() => setShowTerms(false)}
        />
      )}

      {/* Dashboard content — visible but inaccessible behind the modal */}
      <main className="min-h-screen bg-slate-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-slate-900">
              Welcome back, {MOCK_USER.name}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Here&apos;s your dashboard overview.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {[
              { label: "Total Projects", value: "12" },
              { label: "Active Tasks", value: "34" },
              { label: "Team Members", value: "8" },
            ].map((card) => (
              <div
                key={card.label}
                className="bg-white rounded-xl border border-slate-200 p-6"
              >
                <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-1">
                  {card.label}
                </p>
                <p className="text-3xl font-bold text-slate-900">{card.value}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}