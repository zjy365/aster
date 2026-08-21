import { ImageResponse } from "next/og";

export const dynamic = "force-static";

export const alt = "Aster — A quiet workbench for Kubernetes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f6f3",
          color: "#1d1d1f",
        }}
      >
        <svg width="72" height="74" viewBox="0 0 86 88" fill="#c65f2d">
          <rect x="33.25" y="0" width="19.5" height="88" />
          <rect x="33.25" y="0" width="19.5" height="88" transform="rotate(60 43 44)" />
          <rect x="33.25" y="0" width="19.5" height="88" transform="rotate(-60 43 44)" />
        </svg>
        <div
          style={{
            marginTop: "28px",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontStyle: "italic",
            fontSize: "56px",
            letterSpacing: "-0.02em",
          }}
        >
          A quiet workbench for Kubernetes
        </div>
      </div>
    ),
    { ...size },
  );
}
