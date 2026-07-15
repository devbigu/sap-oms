"use client";

import { useEffect, useState } from "react";
import { resolveStoredAuth, type AuthSession } from "@/lib/roleAccess";

type ResolvedAuth =
  | { loading: true; session: null }
  | { loading: false; session: AuthSession };

export function useAuthSession(): ResolvedAuth {
  const [state, setState] = useState<ResolvedAuth>({ loading: true, session: null });

  useEffect(() => {
    const resolve = () => {
      setState({ loading: false, session: resolveStoredAuth(localStorage) });
    };

    resolve();
    window.addEventListener("storage", resolve);
    window.addEventListener("omsons-auth-changed", resolve);

    return () => {
      window.removeEventListener("storage", resolve);
      window.removeEventListener("omsons-auth-changed", resolve);
    };
  }, []);

  return state;
}
