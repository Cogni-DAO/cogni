// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/app-layout-auth-guard`
 * Purpose: Unit tests for (app)/layout auth guard invariant enforcement.
 * Scope: Tests that AppLayout enforces route protection via redirect. Does not test routing or actual NextAuth integration.
 * Invariants: loading shows UI; unauthenticated redirects; authenticated renders children. No auto sign-out - sign-out is explicit user action only.
 * Side-effects: none (mocked hooks)
 * Notes: Uses React Testing Library with mocked useSession and useRouter. DOM environment via test-level override.
 * Links: src/app/(app)/layout.tsx, docs/spec/security-auth.md
 * @public
 */

// @vitest-environment happy-dom

import "@testing-library/jest-dom/vitest";

import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Next.js navigation hooks
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => "/chat",
}));

// Mock next-auth/react hooks
let mockSessionData: {
  status: "loading" | "authenticated" | "unauthenticated";
  data: { user?: { walletAddress?: string } } | null;
};

vi.mock("next-auth/react", () => ({
  useSession: () => mockSessionData,
}));

// Stub sidebar shell so this test stays scoped to the auth guard branches
vi.mock("@/components", () => ({
  SidebarProvider: ({ children }: { children?: ReactNode }) => (
    <div data-testid="sidebar-provider">{children}</div>
  ),
  SidebarInset: ({ children }: { children?: ReactNode }) => (
    <div data-testid="sidebar-inset">{children}</div>
  ),
}));

vi.mock("@/features/layout", () => ({
  AppSidebar: () => <div data-testid="app-sidebar" />,
  AppTopBar: () => <div data-testid="app-topbar" />,
}));

describe("AppLayout Auth Guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading UI when status is loading", async () => {
    mockSessionData = {
      status: "loading",
      data: null,
    };

    const { default: APP_LAYOUT } = await import("@/app/(app)/layout");

    render(
      <APP_LAYOUT>
        <div data-testid="children">Protected Content</div>
      </APP_LAYOUT>
    );

    // Should show loading state
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // Should not render children
    expect(screen.queryByTestId("children")).not.toBeInTheDocument();

    // Should not call navigation
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects to home when status is unauthenticated", async () => {
    mockSessionData = {
      status: "unauthenticated",
      data: null,
    };

    const { default: APP_LAYOUT } = await import("@/app/(app)/layout");

    const { container } = render(
      <APP_LAYOUT>
        <div data-testid="children">Protected Content</div>
      </APP_LAYOUT>
    );

    // Should call router.replace('/') via useEffect
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });

    // Should render null (container should be empty)
    expect(container.firstChild).toBeNull();

    // Should not render children
    expect(screen.queryByTestId("children")).not.toBeInTheDocument();
  });

  it("renders children when authenticated with valid walletAddress", async () => {
    mockSessionData = {
      status: "authenticated",
      data: {
        user: {
          walletAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
        },
      },
    };

    const { default: APP_LAYOUT } = await import("@/app/(app)/layout");

    render(
      <APP_LAYOUT>
        <div data-testid="children">Protected Content</div>
      </APP_LAYOUT>
    );

    // Should render children
    expect(screen.getByTestId("children")).toBeInTheDocument();
    expect(screen.getByText("Protected Content")).toBeInTheDocument();

    // Should not call router.replace
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("renders children when authenticated even if walletAddress is missing (no auto sign-out)", async () => {
    // This tests the new invariant: no auto sign-out based on session state
    // Sign-out must be explicit user action
    mockSessionData = {
      status: "authenticated",
      data: {
        user: {}, // No walletAddress - but should NOT auto sign-out
      },
    };

    const { default: APP_LAYOUT } = await import("@/app/(app)/layout");

    render(
      <APP_LAYOUT>
        <div data-testid="children">Protected Content</div>
      </APP_LAYOUT>
    );

    // Should render children (authenticated = render, regardless of walletAddress)
    expect(screen.getByTestId("children")).toBeInTheDocument();

    // Should not redirect
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
