import { useId } from "react";
import Svg, { Defs, Ellipse, G, Line, LinearGradient, Polygon, RadialGradient, Rect, Stop } from "react-native-svg";

/**
 * The medicine drawn as a soft 3D pair of tablets (after the AI Health Companion kit's medicines grid:
 * white rounds, pink and blue caplets, green and lilac scored hexagons): each a lit top face over a
 * darker side for thickness, a gloss highlight and a score line, resting on a soft shadow.
 * Illustrative dosage forms and colours only, never a brand's pack or imprint. `tint` is the pale wash
 * a medicine sits on when it needs a backdrop (a tile icon).
 */
type Look = { form: "tablet" | "caplet" | "hex"; light: string; base: string; side: string; tint: string };
const WHITE: Look = { form: "tablet", light: "#FFFFFF", base: "#EDE9E3", side: "#CFC8BD", tint: "#F6F4F0" };
const PINK: Look = { form: "caplet", light: "#FFE4EC", base: "#F5A8BE", side: "#DA7F9B", tint: "#FDF0F4" };
const GREEN: Look = { form: "hex", light: "#E6F6EE", base: "#A9DCC3", side: "#7DBFA0", tint: "#EEF8F3" };
const LILAC: Look = { form: "hex", light: "#F1EAFF", base: "#C9B6F4", side: "#A58FE0", tint: "#F4F0FF" };
const BLUE: Look = { form: "caplet", light: "#E8F1FF", base: "#A9C8F3", side: "#7FA6DE", tint: "#EEF4FD" };
const LOOKS: Record<string, Look> = { Paracetamol: BLUE, Azithromycin: PINK, Cetirizine: WHITE, Salbutamol: GREEN };
// Unknown medicines get a stable look from their name, so the same medicine always looks the same.
const SPARE: Look[] = [WHITE, PINK, GREEN, LILAC];
// Matched on the first word too, so "Salbutamol nebuliser" draws as Salbutamol.
const lookOf = (name: string) => LOOKS[name] ?? LOOKS[name.split(" ")[0]!] ?? SPARE[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % SPARE.length]!;
export const tintOf = (name: string) => lookOf(name).tint;

// A hexagon lying on its face (flattened), 44 across.
const HEX = Array.from({ length: 6 }, (_, i) => `${22 * Math.cos(i * Math.PI / 3)},${17 * Math.sin(i * Math.PI / 3)}`).join(" ");

function One({ look, x, y, angle, scale, id }: { look: Look; x: number; y: number; angle: number; scale: number; id: string }) {
  const { form } = look;
  const w = form === "caplet" ? 52 : form === "hex" ? 44 : 40, h = form === "caplet" ? 24 : form === "hex" ? 34 : 32, depth = 6;
  const face = (dy: number, fill: string) => form === "caplet" ? <Rect x={-w / 2} y={-h / 2 + dy} width={w} height={h} rx={h / 2} fill={fill} />
    : form === "hex" ? <Polygon points={HEX} fill={fill} strokeLinejoin="round" stroke={fill} strokeWidth={5} transform={`translate(0 ${dy})`} />
    : <Ellipse cx={0} cy={dy} rx={w / 2} ry={h / 2} fill={fill} />;
  const score = { stroke: look.side, strokeWidth: 1.4, strokeLinecap: "round" as const, opacity: 0.8 };
  return <G transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
    {face(depth, look.side)}
    {face(0, `url(#${id}-face)`)}
    <Ellipse cx={-w * 0.16} cy={-h * 0.2} rx={w * 0.22} ry={h * 0.16} fill="#FFFFFF" opacity={0.6} />
    {form === "caplet" ? <Line x1={0} y1={-h / 2 + 3} x2={0} y2={h / 2 - 3} {...score} />
      : form === "hex" ? <><Line x1={-w / 2 + 6} y1={0} x2={w / 2 - 6} y2={0} {...score} /><Line x1={0} y1={-h / 2 + 5} x2={0} y2={h / 2 - 5} {...score} /></>
      : <Line x1={-w / 2 + 5} y1={0} x2={w / 2 - 5} y2={0} {...score} />}
  </G>;
}

export function Pill({ name, size }: { name: string; size: number }) {
  const look = lookOf(name), id = useId().replace(/:/g, "");
  const tilt = look.form === "caplet" ? [-32, -24] : [-18, -10];
  return <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <Defs>
      <LinearGradient id={`${id}-face`} x1="0" y1="0" x2="0.35" y2="1">
        <Stop offset="0" stopColor={look.light} />
        <Stop offset="1" stopColor={look.base} />
      </LinearGradient>
      <RadialGradient id={`${id}-shadow`} cx="50%" cy="50%" rx="50%" ry="50%">
        <Stop offset="0" stopColor="#1A2350" stopOpacity={0.16} />
        <Stop offset="1" stopColor="#1A2350" stopOpacity={0} />
      </RadialGradient>
    </Defs>
    <Ellipse cx={52} cy={80} rx={36} ry={9} fill={`url(#${id}-shadow)`} />
    <One look={look} x={40} y={46} angle={tilt[0]!} scale={0.92} id={id} />
    <One look={look} x={60} y={60} angle={tilt[1]!} scale={1} id={id} />
  </Svg>;
}
