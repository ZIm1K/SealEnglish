// Instagram feed card (4:5 still): generated background photo, big hook headline, optional
// English line with translation, brand mark with Sílі.
import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import type { IgCardProps } from "../src/schema.ts";
import { BrandBackground } from "./parts.tsx";
import { body, C, display } from "./theme.ts";

export const IG_W = 1080;
export const IG_H = 1350;

export const IgCard: React.FC<IgCardProps> = ({ image_src, headline, sub, handle }) => (
  <AbsoluteFill style={{ background: C.navy }}>
    {image_src ? (
      <Img src={staticFile(image_src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    ) : (
      <BrandBackground seed={3} />
    )}
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(6,20,40,0.82) 0%, rgba(6,20,40,0.55) 38%, rgba(6,20,40,0) 62%)" }} />
    <div style={{ position: "absolute", top: 90, left: 80, right: 80 }}>
      <div
        style={{
          fontFamily: display,
          fontWeight: 900,
          fontSize: headline.length > 32 ? 76 : 92,
          lineHeight: 1.08,
          color: C.white,
          textShadow: "0 8px 30px rgba(0,0,0,0.45)",
        }}
      >
        {headline}
      </div>
      {sub && (
        <div
          style={{
            display: "inline-block",
            marginTop: 34,
            padding: "16px 28px",
            borderRadius: 24,
            background: C.sky,
            color: C.navy,
            fontFamily: body,
            fontWeight: 800,
            fontSize: 40,
            lineHeight: 1.2,
          }}
        >
          {sub}
        </div>
      )}
    </div>
    <div style={{ position: "absolute", bottom: 50, left: 60, display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ width: 96, height: 96, borderRadius: "50%", background: C.sky, overflow: "hidden", border: "4px solid white" }}>
        <Img src={staticFile("mascot3d/stand-happy.sm.webp")} style={{ width: 140, marginLeft: -22, marginTop: -4 }} />
      </div>
      <div style={{ fontFamily: body, fontWeight: 800, fontSize: 36, color: C.white, textShadow: "0 2px 12px rgba(0,0,0,0.8)" }}>{handle}</div>
    </div>
  </AbsoluteFill>
);
