import type { CSSProperties } from "react";
import lovableHeart from "@/assets/lovable-heart.png";

type MilestoneHeartOverlayProps = {
  phase: "grow" | "erase";
  overlayKey: number;
  remainingLabel: string;
};

const HEART_ART_SIZE = 440;
const HEART_TEXT_SIZE = "8rem";
const HEART_TEXT_SIZE_LONG = "4.5rem";

export const MilestoneHeartOverlay = ({ phase, overlayKey, remainingLabel }: MilestoneHeartOverlayProps) => {
  const animationClass = phase === "grow" ? "animate-heart-grow" : "animate-heart-erase";
  const textAnimationClass = phase === "grow" ? "animate-heart-text-appear" : "animate-heart-erase";
  // Use a smaller font for longer labels (e.g. "Time's Up!") so the text
  // stays inside the heart shape instead of overflowing its width.
  const fontSize = remainingLabel.length > 6 ? HEART_TEXT_SIZE_LONG : HEART_TEXT_SIZE;

  return (
    <div
      key={overlayKey}
      className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none"
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <div className="relative flex items-center justify-center pointer-events-none" style={{ width: HEART_ART_SIZE, height: HEART_ART_SIZE }}>
        <img
          src={lovableHeart}
          alt=""
          className={`${animationClass} pointer-events-none`}
          style={{ width: HEART_ART_SIZE, height: HEART_ART_SIZE } as CSSProperties}
        />
        <span
          className={`${textAnimationClass} pointer-events-none`}
          style={{
            position: "absolute",
            color: "white",
            fontWeight: 800,
            fontSize,
            textShadow: "0 2px 8px rgba(0,0,0,0.3)",
            width: HEART_ART_SIZE,
            height: HEART_ART_SIZE,
            display: "flex",
            alignItems: "flex-start",
            paddingTop: "45%",
            justifyContent: "center",
            transformOrigin: "center",
            whiteSpace: "nowrap",
          }}
        >
          {remainingLabel}
        </span>
      </div>
    </div>
  );
};
