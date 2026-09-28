import qrcode from "qrcode-generator";
import { useEffect, useState } from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { api, errorText, useLive } from "@/features/live";
import { useRole } from "@/features/live/roles";

/**
 * The Sona Care invite on the discharge receipt: a QR of the patient's one-time join link and the
 * code under it, to print on the discharge paper or show on this screen for the patient to scan.
 * Live mode only; the code lives on the server.
 */
export function CareInvite({ encounterId }: { encounterId: string }) {
  // Only a doctor or a nurse gives a code (care.code); other roles see no invite.
  const { on: live } = useLive();
  const role = useRole();
  const on = live && role.can("care.code");
  const [invite, setInvite] = useState<{ code: string; link: string; joined: boolean }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!on) return;
    api.care.code({ encounterId }).then(setInvite, e => setError(errorText(e)));
  }, [on, encounterId]);
  if (!on) return null;
  if (error) return <Text selectable style={{ ...type.caption, color: palette.red }}>Sona Care invite unavailable: {error}</Text>;
  if (!invite) return null;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 12, borderRadius: 18, borderCurve: "continuous", backgroundColor: palette.white }}>
    <Qr text={invite.link} size={96} />
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={{ ...type.overline, color: palette.blue }}>Sona Care</Text>
      <Text style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>{invite.joined ? "Patient has joined" : "Scan to follow up at home"}</Text>
      <Text selectable style={{ fontSize: 18, fontWeight: "700", letterSpacing: 2, color: palette.ink, fontVariant: ["tabular-nums"] }}>{invite.code}</Text>
      <Text style={{ ...type.caption, color: palette.muted }}>Check-ins, leaflet and follow-ups on their own phone</Text>
    </View>
  </View>;
}

/** A QR code as one SVG path (medium error correction, so a crease on the printed paper still scans). */
function Qr({ text, size }: { text: string; size: number }) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), quiet = 2, total = n + quiet * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`} accessibilityLabel="QR code to join Sona Care">
    <Path d={`M0 0h${total}v${total}H0z`} fill={palette.white} />
    <Path d={d} fill={palette.ink} />
  </Svg>;
}
