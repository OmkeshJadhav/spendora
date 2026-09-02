"use client";

/**
 * Replaces the root layout when it fails, so it renders its own document and
 * cannot rely on the application's global styles.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <title>Something went wrong</title>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
          Something went wrong
        </h1>
        <p style={{ maxWidth: "24rem", opacity: 0.7 }}>
          The application failed to load. Please try again.
        </p>
        {error.digest ? (
          <p style={{ fontSize: "0.75rem", opacity: 0.6 }}>
            Reference: <span style={{ fontFamily: "monospace" }}>{error.digest}</span>
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => retry()}
          style={{
            border: "1px solid currentColor",
            borderRadius: "0.5rem",
            padding: "0.5rem 1rem",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
