// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import { useState } from "react";

import { getAuthClient } from "../../lib/auth-client";

export function SignInView() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          width: "min(32rem, 100%)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "1rem",
          padding: "2rem",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
          boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
        }}
      >
        <p
          style={{
            margin: 0,
            color: "rgba(245,247,251,0.72)",
            fontSize: "0.875rem",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Centralized OAuth
        </p>
        <h1 style={{ margin: "0.75rem 0 0.5rem", fontSize: "2rem" }}>
          Sign in with GitHub
        </h1>
        <p
          style={{
            margin: 0,
            color: "rgba(245,247,251,0.82)",
            lineHeight: 1.6,
          }}
        >
          This hub owns the single GitHub callback and continues the
          authorization flow back to the correct Cogni deployment after sign-in.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(null);

            try {
              await getAuthClient().signIn.social({
                provider: "github",
              });
            } catch (signInError) {
              setError(
                signInError instanceof Error
                  ? signInError.message
                  : "GitHub sign-in failed."
              );
              setPending(false);
            }
          }}
          style={{
            marginTop: "1.5rem",
            width: "100%",
            border: 0,
            borderRadius: "0.75rem",
            padding: "0.95rem 1rem",
            background: pending ? "#4b5563" : "#f5f7fb",
            color: "#0a0f1a",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: pending ? "progress" : "pointer",
          }}
        >
          {pending ? "Redirecting to GitHub..." : "Continue with GitHub"}
        </button>
        {error ? (
          <p style={{ marginTop: "1rem", color: "#fda4af" }}>{error}</p>
        ) : null}
      </div>
    </main>
  );
}
