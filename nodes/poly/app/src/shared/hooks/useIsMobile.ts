// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/hooks/useIsMobile`
 * Purpose: Reactive hook that tracks mobile viewport breakpoint.
 * Scope: Returns boolean for <768px viewport. Does not handle resize debouncing or SSR hydration.
 * Invariants: Returns false during SSR/initial render; true reactivity after mount.
 * Side-effects: IO (window.matchMedia listener)
 * Links:
 * @public
 */

import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
