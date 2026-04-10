// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

export default function HomePage() {
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
          width: "min(42rem, 100%)",
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
          Cogni Platform
        </p>
        <h1 style={{ margin: "0.75rem 0 0.5rem", fontSize: "2.25rem" }}>
          Auth Hub
        </h1>
        <p
          style={{
            margin: 0,
            color: "rgba(245,247,251,0.82)",
            lineHeight: 1.6,
          }}
        >
          This prototype centralizes GitHub OAuth for all local Cogni nodes.
          Start sign-in from operator, poly, or resy and the hub will complete
          the shared OAuth flow here.
        </p>
      </div>
    </main>
  );
}
