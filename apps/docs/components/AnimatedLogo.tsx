"use client";

import { useEffect, useState } from "react";

const SIZE = 80;

/**
 * A→T→A logo animation: the tool (A) flips to the task (T) and back.
 * The switch to “T” symbolizes the tool adapting to the task (the nut stays fixed).
 * Same animation as the app’s loading indicator; CSS in globals.css.
 */
export default function AnimatedLogo() {
  const [basePath, setBasePath] = useState("");
  useEffect(() => {
    const path =
      (typeof document !== "undefined" && document.body.getAttribute("data-base-path")) || "";
    setBasePath(path.replace(/\/+$/, "") || "");
  }, []);

  const img = (name: string) => `${basePath}/img/${name}`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        flexWrap: "wrap",
        marginTop: "0.75rem",
      }}
    >
      <div className="logo-loading-stage" style={{ width: SIZE, height: SIZE }} aria-hidden>
        <div className="logo-loading-inner" style={{ width: SIZE, height: SIZE }}>
          <div className="logo-loading-letters" style={{ width: SIZE, height: SIZE }}>
            <img
              src={img("icon-a-letter.svg")}
              alt=""
              className="logo-loading-front"
              width={SIZE}
              height={SIZE}
            />
            <img
              src={img("icon-t-letter.svg")}
              alt=""
              className="logo-loading-back"
              width={SIZE}
              height={SIZE}
            />
          </div>
          <img
            src={img("icon-circle.svg")}
            alt=""
            className="logo-loading-circle"
            width={SIZE}
            height={SIZE}
          />
        </div>
      </div>
      <span style={{ fontSize: "0.9rem", color: "rgb(100 116 139)" }}>
        A→T→A in a loop: the switch to “T” symbolizes adaptation to the task; the switch back
        symbolizes continuous adaptation that never stops.
      </span>
    </div>
  );
}
