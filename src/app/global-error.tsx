"use client";

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#f9f7f2",
          color: "#252b24",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <main
          role="alert"
          style={{ maxWidth: 480, margin: "15vh auto", padding: 24 }}
        >
          <h1 style={{ fontFamily: "Georgia, serif" }}>
            Service is temporarily unavailable.
          </h1>
          <p style={{ lineHeight: 1.7 }}>
            Please reconnect and try again. An interrupted response does not
            confirm a new order. Keep your original browser open so an existing
            submission can be checked safely.
          </p>
          <button
            onClick={retry}
            style={{
              minHeight: 48,
              padding: "12px 24px",
              background: "#314d3b",
              color: "white",
              border: 0,
              borderRadius: 24,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
