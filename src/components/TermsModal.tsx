"use client";

// components/TermsModal.tsx
import { useState, useEffect, useRef } from "react";

interface TermsModalProps {
  userId: string;
  userName: string;
  email: string;
  /** Called after successful acceptance so parent can hide modal */
  onAccepted: () => void;
}

export default function TermsModal({
  userId,
  userName,
  email,
  onAccepted,
}: TermsModalProps) {
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track scroll — user must reach the bottom before checkbox unlocks
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      if (atBottom) setHasScrolledToBottom(true);
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  const canAccept = hasScrolledToBottom && isChecked;

  async function handleAccept() {
    if (!canAccept) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, userName, email }),
      });

      if (!res.ok) throw new Error("Failed to save agreement.");

      // Mark in localStorage so modal does not show again for this user
      localStorage.setItem(`terms_accepted_${userId}`, "true");
      onAccepted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl mx-4 flex flex-col bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[92vh]">

        {/* Header */}
        <div className="px-8 pt-8 pb-5 border-b border-slate-100">
          <div className="flex items-center gap-3 mb-1">
            <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-slate-900">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </span>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
              Terms &amp; Conditions
            </h1>
          </div>
          <p className="text-sm text-slate-500 ml-12">
            Please read the entire document before accepting.
          </p>
        </div>

        {/* Scrollable T&C Body */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-8 py-6 text-sm text-slate-700 leading-relaxed space-y-5"
        >
          <TermsSection title="1. Acceptance of Terms">
            By accessing or using this platform, you agree to be bound by these Terms and Conditions and all applicable laws and regulations. If you do not agree with any part of these terms, you are prohibited from using or accessing this platform.
          </TermsSection>

          <TermsSection title="2. Use License">
            Permission is granted to temporarily access the platform for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not modify or copy the materials, use the materials for any commercial purpose or for any public display, or remove any copyright or other proprietary notations from the materials.
          </TermsSection>

          <TermsSection title="3. Data &amp; Privacy">
            We collect information you provide directly to us. We may use your information to operate, maintain, and improve our services; process transactions; send you technical notices, updates, security alerts, and support messages. We do not sell, trade, or transfer your personally identifiable information to third parties without your consent.
          </TermsSection>

          <TermsSection title="4. User Responsibilities">
            You are responsible for maintaining the confidentiality of your account and password. You agree to accept responsibility for all activities that occur under your account. You must notify us immediately of any unauthorized use of your account or any breach of security.
          </TermsSection>

          <TermsSection title="5. Prohibited Activities">
            You are prohibited from using the platform to transmit any unsolicited or unauthorized advertising or promotional material, engage in any conduct that restricts or inhibits anyone's use or enjoyment of the platform, or use the platform in any way that violates any applicable local, national, or international law or regulation.
          </TermsSection>

          <TermsSection title="6. Disclaimer">
            The materials on this platform are provided on an &apos;as is&apos; basis. We make no warranties, expressed or implied, and hereby disclaim all other warranties including without limitation implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property.
          </TermsSection>

          <TermsSection title="7. Limitations">
            In no event shall the platform or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on the platform.
          </TermsSection>

          <TermsSection title="8. Governing Law">
            These terms and conditions are governed by and construed in accordance with applicable laws and you irrevocably submit to the exclusive jurisdiction of the courts in the applicable location.
          </TermsSection>

          {!hasScrolledToBottom && (
            <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <svg className="w-4 h-4 shrink-0 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Scroll to the bottom to enable acceptance
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-slate-100 bg-slate-50 space-y-4">
          {/* Checkbox — locked until user scrolls to bottom */}
          <label
            className={`flex items-start gap-3 cursor-pointer select-none group ${
              !hasScrolledToBottom ? "opacity-40 pointer-events-none" : ""
            }`}
          >
            <div className="relative mt-0.5">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) => setIsChecked(e.target.checked)}
                disabled={!hasScrolledToBottom}
                className="sr-only"
              />
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-150 ${
                  isChecked
                    ? "bg-slate-900 border-slate-900"
                    : "border-slate-300 bg-white group-hover:border-slate-400"
                }`}
              >
                {isChecked && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
            <span className="text-sm text-slate-700 leading-snug">
              I have read, understood, and agree to the Terms &amp; Conditions above.
            </span>
          </label>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleAccept}
            disabled={!canAccept || isSubmitting}
            className={`w-full py-3 rounded-xl text-sm font-semibold tracking-wide transition-all duration-200 ${
              canAccept && !isSubmitting
                ? "bg-slate-900 text-white hover:bg-slate-700 active:scale-[0.98] shadow-sm"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Saving your agreement…
              </span>
            ) : (
              "I Accept — Continue to Dashboard"
            )}
          </button>

          <p className="text-xs text-center text-slate-400">
            Accepting as <span className="font-medium text-slate-600">{userName}</span>
            {" "}·{" "}
            ID: <span className="font-mono">{userId}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function TermsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-semibold text-slate-900 mb-1.5">{title}</h2>
      <p>{children}</p>
    </div>
  );
}