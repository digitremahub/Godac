import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 96,
        }}
      >
        <div
          style={{
            width: 280,
            height: 280,
            borderRadius: 56,
            background: "#1BE4C1",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 220,
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
