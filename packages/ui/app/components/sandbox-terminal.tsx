"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type SandboxTerminalProps = {
  sandboxId: string;
  sandboxName?: string;
  className?: string;
};

export function SandboxTerminal({ sandboxId, sandboxName, className }: SandboxTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !sandboxId) return;

    const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = typeof window !== "undefined" ? window.location.host : "localhost:3000";
    const wsUrl = `${protocol}//${host}/api/sandbox-shell?sid=${encodeURIComponent(sandboxId)}`;

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let ws: WebSocket | null = null;

    const cleanup = () => {
      try {
        ws?.close();
        ws = null;
      } catch {
        /* ignore */
      }
      try {
        term?.dispose();
        term = null;
        fitAddon = null;
      } catch {
        /* ignore */
      }
    };

    try {
      term = new Terminal({
        theme: {
          background: "var(--bg, #0b1120)",
          foreground: "var(--text, #e2e8f0)",
          cursor: "var(--text, #e2e8f0)",
          cursorAccent: "var(--bg, #0b1120)",
        },
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 14,
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      const resizeObserver = new ResizeObserver(() => {
        fitAddon?.fit();
        if (ws?.readyState === WebSocket.OPEN && term) {
          const { cols, rows } = term;
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });
      resizeObserver.observe(containerRef.current);

      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setStatus("connected");
        setErrorMessage(null);
        if (term) {
          const { cols, rows } = term;
          ws?.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      };

      ws.onmessage = (event: MessageEvent<string | Blob>) => {
        const data = typeof event.data === "string" ? event.data : null;
        if (data?.startsWith("{")) {
          try {
            const msg = JSON.parse(data) as { type?: string; message?: string };
            if (msg.type === "error") {
              setStatus("error");
              setErrorMessage(msg.message ?? "Error");
              return;
            }
          } catch {
            /* not JSON, pass through */
          }
        }
        const text = typeof event.data === "string" ? event.data : (event.data as Blob).size ? "" : String(event.data);
        if (text) term?.write(text);
      };

      ws.onclose = () => {
        setStatus("disconnected");
        cleanup();
      };

      ws.onerror = () => {
        setStatus("error");
        setErrorMessage("WebSocket error");
      };

      term.onData((data: string) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(data);
      });

      return () => {
        resizeObserver.disconnect();
        cleanup();
      };
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
      return cleanup;
    }
  }, [sandboxId]);

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 200 }}>
      {(status === "connecting" || status === "error" || status === "disconnected") && (
        <div
          style={{
            padding: "0.5rem 0.75rem",
            fontSize: "0.875rem",
            background: "var(--surface-muted)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          {status === "connecting" && <span>Connecting to {sandboxName ?? "sandbox"}…</span>}
          {status === "disconnected" && <span style={{ color: "var(--text-muted)" }}>Disconnected.</span>}
          {status === "error" && (
            <span style={{ color: "var(--resource-red)" }}>{errorMessage ?? "Connection failed."}</span>
          )}
        </div>
      )}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
