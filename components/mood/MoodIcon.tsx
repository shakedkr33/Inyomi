import { Circle, Path, Svg } from 'react-native-svg';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MoodValue = 0 | 1 | 2 | 3 | 4;

interface MoodIconProps {
  value: MoodValue;
  size?: number; // default 48
  active?: boolean; // false → opacity 0.4
}

// ─── Color tokens per mood ────────────────────────────────────────────────────

const MOOD_TOKENS: Record<
  MoodValue,
  { bg: string; stroke: string }
> = {
  4: { bg: '#FEF3C7', stroke: '#F59E0B' }, // מדהים – amber
  3: { bg: '#DCFCE7', stroke: '#22C55E' }, // בסדר  – green
  2: { bg: '#E5E7EB', stroke: '#6B7280' }, // רגיל  – slate
  1: { bg: '#DBEAFE', stroke: '#2563EB' }, // עמוס  – blue
  0: { bg: '#FEE2E2', stroke: '#DC2626' }, // מתסכל – red
};

// ─── Face SVG renderer ────────────────────────────────────────────────────────

function FacePaths({ value, stroke, sw }: { value: MoodValue; stroke: string; sw: number }) {
  // All faces drawn on a 48×48 viewBox, center (24,24)
  // Eye centres: left (16,19), right (32,19)
  // Mouth region: y ≈ 28–34

  switch (value) {
    // ── 4: מדהים – big smile, happy-squint eyes ──────────────────────────────
    case 4:
      return (
        <>
          {/* Left squint eye – arch curving upward */}
          <Path
            d="M13 20 Q16 15 19 20"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
          {/* Right squint eye */}
          <Path
            d="M29 20 Q32 15 35 20"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
          {/* Wide smile */}
          <Path
            d="M13 28 Q24 38 35 28"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
        </>
      );

    // ── 3: בסדר – gentle smile, round eyes ───────────────────────────────────
    case 3:
      return (
        <>
          <Circle cx={16} cy={19} r={2} fill={stroke} opacity={0.85} />
          <Circle cx={32} cy={19} r={2} fill={stroke} opacity={0.85} />
          {/* Gentle smile arc */}
          <Path
            d="M16 29 Q24 35 32 29"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
        </>
      );

    // ── 2: רגיל – neutral, straight mouth ────────────────────────────────────
    case 2:
      return (
        <>
          <Circle cx={16} cy={19} r={2} fill={stroke} opacity={0.85} />
          <Circle cx={32} cy={19} r={2} fill={stroke} opacity={0.85} />
          {/* Straight mouth */}
          <Path
            d="M17 30 L31 30"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
        </>
      );

    // ── 1: עמוס – worried brows, slightly troubled mouth ─────────────────────
    case 1:
      return (
        <>
          {/* Worried brows – angled inward at top */}
          <Path
            d="M12 16 Q16 13 19 16"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
          <Path
            d="M29 16 Q32 13 36 16"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
          <Circle cx={16} cy={21} r={2} fill={stroke} opacity={0.85} />
          <Circle cx={32} cy={21} r={2} fill={stroke} opacity={0.85} />
          {/* Mouth: flat with very slight frown at corners */}
          <Path
            d="M15 31 Q24 28 33 31"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
        </>
      );

    // ── 0: מתסכל – furrowed brows, frown ──────────────────────────────────────
    case 0:
      return (
        <>
          {/* Furrowed brows – slanted downward toward center */}
          <Path
            d="M12 17 L19 14"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
          <Path
            d="M29 14 L36 17"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
          <Circle cx={16} cy={21} r={2} fill={stroke} opacity={0.85} />
          <Circle cx={32} cy={21} r={2} fill={stroke} opacity={0.85} />
          {/* Frown – downward arc */}
          <Path
            d="M16 33 Q24 26 32 33"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
            opacity={0.85}
          />
        </>
      );
  }
}

// ─── MoodIcon ─────────────────────────────────────────────────────────────────

export function MoodIcon({ value, size = 48, active = true }: MoodIconProps) {
  const { bg, stroke } = MOOD_TOKENS[value];
  const strokeWidth = size <= 32 ? 1.5 : 2;

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      opacity={active ? 1 : 0.4}
    >
      {/* Background circle */}
      <Circle cx={24} cy={24} r={22} fill={bg} />
      {/* Face paths */}
      <FacePaths value={value} stroke={stroke} sw={strokeWidth} />
    </Svg>
  );
}
