// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

"use client";

import { useMemo, useState } from "react";

function getSignedOAuthQuery(): string | undefined {
  const params = new URLSearchParams(window.location.search);

  if (!params.has("sig")) {
    return undefined;
  }

  const signed = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    signed.append(key, value);
    if (key === "sig") {
      break;
    }
  }

  return signed.toString();
}

export function ConsentView() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedScopes = useMemo(() => {
    const scope = new URLSearchParams(window.location.search).get("scope");
    return scope?.split(" ").filter(Boolean) ?? ["openid", "profile", "email"];
  }, []);

  async function handleConsent(accept: boolean) {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accept,
          oauth_query: getSignedOAuthQuery(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to process OAuth consent.");
      }

      const data = (await response.json()) as { redirect_uri?: string };
      if (!data.redirect_uri) {
        throw new Error("OAuth consent response did not include a redirect.");
      }

      window.location.assign(data.redirect_uri);
    } catch (consentError) {
      setError(
        consentError instanceof Error ? consentError.message : "Consent failed."
      );
      setPending(false);
    }
  }

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
          Authorize Cogni
        </p>
        <h1 style={{ margin: "0.75rem 0 0.5rem", fontSize: "2rem" }}>
          Review requested access
        </h1>
        <p
          style={{
            margin: 0,
            color: "rgba(245,247,251,0.82)",
            lineHeight: 1.6,
          }}
        >
          This local client is asking the shared auth hub for the following
          scopes.
        </p>
        <ul
          style={{
            margin: "1.5rem 0 0",
            paddingLeft: "1.25rem",
            lineHeight: 1.8,
          }}
        >
          {requestedScopes.map((scope) => (
            <li key={scope}>{scope}</li>
          ))}
        </ul>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <button
            type="button"
            disabled={pending}
            onClick={() => void handleConsent(false)}
            style={{
              flex: 1,
              border: "1px solid rgba(255,255,255,0.16)",
              borderRadius: "0.75rem",
              padding: "0.95rem 1rem",
              background: "transparent",
              color: "#f5f7fb",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: pending ? "progress" : "pointer",
            }}
          >
            Deny
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void handleConsent(true)}
            style={{
              flex: 1,
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
            {pending ? "Working..." : "Allow"}
          </button>
        </div>
        {error ? (
          <p style={{ marginTop: "1rem", color: "#fda4af" }}>{error}</p>
        ) : null}
      </div>
    </main>
  );
}
