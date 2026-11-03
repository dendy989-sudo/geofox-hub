"use client";

import { useEffect, useRef } from "react";
import { handoffHomeAuthReturn } from "./home-auth-return-url";

/** Handles default email links that return to the homepage instead of /auth/callback. */
export function HomeAuthReturn() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    handoffHomeAuthReturn(window);
  }, []);
  return null;
}
