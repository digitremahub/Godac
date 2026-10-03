import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0A0F1E",
        }}
      >
        <div
          style={{
            width: 100,
            height: 100,
            borderRadius: 20,
            background: "#1BE4C1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 78,
            fontWeight: 800,
            color: "#0A0F1E",
          }}
        >
          G
        </div>
      </div>
    ),
    { ...size },
  );
}
