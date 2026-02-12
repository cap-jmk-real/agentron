import LogoLoading from "./components/logo-loading";

export default function Loading() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        background: "var(--bg)",
        zIndex: 9999,
      }}
    >
      <LogoLoading size={80} />
      <span style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>Loading…</span>
    </div>
  );
}
