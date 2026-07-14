"use client";

import { useEffect, useState } from "react";

import type { ClientAuthSession } from "@/lib/auth/client";
import { clearStoredAuthData, getLocalAuthResolution } from "@/lib/auth/client";

export function useAuthSession() {
  const [session, setSession] = useState<ClientAuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading");

  useEffect(() => {
    if (typeof window === "undefined") {
      setSession(null);
      setStatus("unauthenticated");
      setLoading(false);
      return;
    }

    let active = true;

    const syncFromStorage = () => {
      const resolution = getLocalAuthResolution();
      if (!active) return;

      if (resolution.status === "authenticated") {
        setSession(resolution.session);
        setStatus("authenticated");
        setLoading(false);
        return;
      }

      if (resolution.status === "invalid") {
        clearStoredAuthData(window.localStorage);
        window.dispatchEvent(new Event("omsons-auth-changed"));
      }

      setSession(null);
      setStatus("unauthenticated");
      setLoading(false);
    };

    const handleWindowFocus = () => syncFromStorage();
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return;
      syncFromStorage();
    };

    syncFromStorage();

    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("omsons-auth-changed", syncFromStorage);

    return () => {
      active = false;
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("omsons-auth-changed", syncFromStorage);
    };
  }, []);

  return { session, loading, status };
}
