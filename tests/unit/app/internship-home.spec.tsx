// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * @vitest-environment jsdom
 *
 * Module: `@tests/unit/app/internship-home`
 * Purpose: Unit coverage for the public internship intake form.
 * Scope: Renders the client page, submits the expanded form, and verifies the Calendly handoff contract. Does not perform real network, calendar, or auth I/O.
 * Invariants: Form payload matches internship.interest.v1; success state exposes Derek interview booking URL.
 * Side-effects: none
 * Links: src/features/home/components/InternshipHome.tsx, src/contracts/internship.interest.v1.contract.ts
 * @public
 */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type MotionProps = React.HTMLAttributes<HTMLElement> & {
  readonly children?: React.ReactNode;
  readonly animate?: unknown;
  readonly initial?: unknown;
  readonly transition?: unknown;
  readonly viewport?: unknown;
  readonly whileInView?: unknown;
};

vi.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) =>
        React.forwardRef<HTMLElement, MotionProps>(
          (
            {
              children,
              animate: _animate,
              initial: _initial,
              transition: _transition,
              viewport: _viewport,
              whileInView: _whileInView,
              ...props
            },
            ref
          ) => React.createElement(tag, { ...props, ref }, children)
        ),
    }
  ) as Record<
    string,
    React.ForwardRefExoticComponent<
      MotionProps & React.RefAttributes<HTMLElement>
    >
  >;

  return {
    motion,
    useReducedMotion: () => true,
  };
});

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

vi.mock("@/features/home/components/InternshipNetworkBackground", () => ({
  InternshipNetworkBackground: () =>
    React.createElement("div", { "data-testid": "internship-background" }),
}));

describe("InternshipHome", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits expanded intake fields and shows Derek interview handoff", async () => {
    class TestIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds = [];
      disconnect(): void {}
      observe(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
      unobserve(): void {}
    }

    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          ok: true,
          referenceId: "candidate-demo-001",
          derekInterviewUrl: "https://calendly.com/derekg1729",
        },
        { status: 201 }
      )
    );
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    vi.stubGlobal("fetch", fetchMock);

    const { InternshipHome } = await import(
      "@/features/home/components/InternshipHome"
    );
    render(React.createElement(InternshipHome));

    const submitButton = screen.getByRole("button", {
      name: /submit interest/i,
    });
    const form = submitButton.closest("form");
    expect(form).not.toBeNull();
    const scoped = within(form as HTMLFormElement);
    const user = userEvent.setup();

    await user.type(scoped.getByLabelText("Name"), "Ada Lovelace");
    await user.type(scoped.getByLabelText("Email"), "ada@example.com");
    await user.type(scoped.getByLabelText("GitHub or portfolio"), "ada");
    await user.type(
      scoped.getByLabelText("Best artifact link"),
      "https://github.com/ada/cogni-agent"
    );
    await user.selectOptions(
      scoped.getByLabelText("Focus"),
      "research-product"
    );
    await user.selectOptions(scoped.getByLabelText("Squad status"), "forming");
    await user.type(scoped.getByLabelText("Timezone"), "Europe/London");
    await user.type(
      scoped.getByLabelText("Weekly availability"),
      "8-10 hours per week"
    );
    await user.type(
      scoped.getByLabelText("What should Derek inspect in your artifact?"),
      "Start with the state machine and duplicate-event tests."
    );
    await user.type(
      scoped.getByLabelText("Why Cogni?"),
      "I want to build durable AI businesses with clear contribution proof."
    );
    await user.selectOptions(
      scoped.getByLabelText("First project direction"),
      "agent-workflows"
    );
    await user.type(
      scoped.getByLabelText("Reliable commitment for the next month"),
      "Two focused build blocks every week."
    );
    await user.click(scoped.getByLabelText(/Derek may use an AI note taker/));
    await user.type(
      scoped.getByLabelText("Anything else Derek should know?"),
      "I learn fastest through shipped feedback."
    );

    await user.click(submitButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      github: "ada",
      artifactUrl: "https://github.com/ada/cogni-agent",
      focus: "research-product",
      squadStatus: "forming",
      timezone: "Europe/London",
      weeklyAvailability: "8-10 hours per week",
      artifactNotes: "Start with the state machine and duplicate-event tests.",
      whyCogni:
        "I want to build durable AI businesses with clear contribution proof.",
      firstProjectChoice: "agent-workflows",
      reliableCommitment: "Two focused build blocks every week.",
      recordingConsent: false,
      note: "I learn fastest through shipped feedback.",
    });

    expect(await screen.findByText(/candidate-demo-001/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /book derek interview/i })
    ).toHaveAttribute("href", "https://calendly.com/derekg1729");
  });
});
