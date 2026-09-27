import { useId } from "react";
import Svg, { Defs, Ellipse, G, Line, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";

/**
 * The medicine drawn as a soft 3D pair of pills (after the Lumi medicines grid): each pill a lit top
 * face over a darker side for thickness, a gloss highlight and a score line, resting on a soft shadow.
 * Illustrative dosage forms and colours only, never a brand's pack or imprint. `tint` is the pale wash
 * a medicine sits on when it needs a backdrop (a tile icon, the dose disc).
 */
type Look = { form: "tablet" | "caplet"; light: string; base: string; side: string; tint: string };
const LOOKS: Record<string, Look> = {
  Paracetamol: { form: "caplet", light: "#FFFFFF", base: "#F1ECE2", side: "#D9D0BF", tint: "#F6F3EC" },
  Azithromycin: { form: "caplet", light: "#E4ECFF", base: "#A9BFF5", side: "#7F98DE", tint: "#EEF2FF" },
  Cetirizine: { form: "tablet", light: "#F3EEFF", base: "#CBBDF7", side: "#A391E6", tint: "#F3F0FF" },
  Salbutamol: { form: "tablet", light: "#EEFBF5", base: "#BDE7D5", side: "#8FCDB3", tint: "#EEF8F4" },
};
// Unknown medicines get a stable colour from their name, so the same medicine always looks the same.
const SPARE: Look[] = [
  { form: "tablet", light: "#FFF1F7", base: "#F4C3DA", side: "#DE98BA", tint: "#FDF1F6" },
  { form: "caplet", light: "#EAF6FF", base: "#B8DAF4", side: "#8AB9DF", tint: "#EEF6FC" },
  { form: "tablet", light: "#FFF8E8", base: "#F3DDA6", side: "#D9BD76", tint: "#FCF7EA" },
];
// Matched on the first word too, so "Salbutamol nebuliser" draws as Salbutamol.
const lookOf = (name: string) => LOOKS[name] ?? LOOKS[name.split(" ")[0]!] ?? SPARE[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % SPARE.length]!;
export const tintOf = (name: string) => lookOf(name).tint;

function One({ look, x, y, angle, scale, id }: { look: Look; x: number; y: number; angle: number; scale: number; id: string }) {
  const caplet = look.form === "caplet";
  const w = caplet ? 50 : 38, h = caplet ? 22 : 32, depth = 5;
  const face = (dy: number, fill: string) => caplet
    ? <Rect x={-w / 2} y={-h / 2 + dy} width={w} height={h} rx={h / 2} fill={fill} />
    : <Ellipse cx={0} cy={dy} rx={w / 2} ry={h / 2} fill={fill} />;
  return <G transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
    {face(depth, look.side)}
    {face(0, `url(#${id}-face)`)}
    <Ellipse cx={-w * 0.16} cy={-h * 0.2} rx={w * 0.22} ry={h * 0.16} fill="#FFFFFF" opacity={0.55} />
    {caplet ? <Line x1={0} y1={-h / 2 + 3} x2={0} y2={h / 2 - 3} stroke={look.side} strokeWidth={1.4} strokeLinecap="round" opacity={0.8} />
      : <Line x1={-w / 2 + 5} y1={0} x2={w / 2 - 5} y2={0} stroke={look.side} strokeWidth={1.4} strokeLinecap="round" opacity={0.8} />}
  </G>;
}

export function Pill({ name, size }: { name: string; size: number }) {
  const look = lookOf(name), id = useId().replace(/:/g, "");
  return <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Defs>
      <LinearGradient id={`${id}-face`} x1="0" y1="0" x2="0.35" y2="1">
        <Stop offset="0" stopColor={look.light} />
        <Stop offset="1" stopColor={look.base} />
      </LinearGradient>
      <RadialGradient id={`${id}-shadow`} cx="50%" cy="50%" rx="50%" ry="50%">
        <Stop offset="0" stopColor="#1A2350" stopOpacity={0.18} />
        <Stop offset="1" stopColor="#1A2350" stopOpacity={0} />
      </RadialGradient>
    </Defs>
    <Ellipse cx={52} cy={80} rx={36} ry={9} fill={`url(#${id}-shadow)`} />
    <One look={look} x={40} y={46} angle={look.form === "caplet" ? -32 : -18} scale={0.92} id={id} />
    <One look={look} x={60} y={60} angle={look.form === "caplet" ? -24 : -10} scale={1} id={id} />
  </Svg>;
}
