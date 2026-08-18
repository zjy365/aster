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
        <svg width="72" height="72" viewBox="0 0 24 24" fill="none">
          <g stroke="#c65f2d" strokeWidth="2.1" strokeLinecap="round">
            <path d="M12 3v18" />
            <path d="M4.2 7.5l15.6 9" />
            <path d="M19.8 7.5l-15.6 9" />
          </g>
          <circle cx="12" cy="12" r="2.6" fill="#c65f2d" />
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
