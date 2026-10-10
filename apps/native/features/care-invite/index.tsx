import { printAsync } from "expo-print";
import qrcode from "qrcode-generator";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { api, errorText, useLive } from "@/features/live";
import { useRole } from "@/features/live/roles";

const SCAN = "Scan with the phone camera, or open Sona Care and enter this code.";

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
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 12, borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white }}>
    <Qr text={invite.link} size={96} />
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={{ ...type.overline, color: palette.blue }}>Sona Care</Text>
      <Text style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>{invite.joined ? "Patient has joined" : "Scan to follow up at home"}</Text>
      <Text selectable style={{ ...type.headline, fontWeight: "700", letterSpacing: 2, color: palette.ink, fontVariant: ["tabular-nums"] }}>{invite.code}</Text>
      <Text style={{ ...type.caption, color: palette.muted }}>Check-ins, leaflet and follow-ups on their own phone</Text>
      {!invite.joined && <Pressable accessibilityRole="button" accessibilityLabel="Print the Sona Care code" hitSlop={8} onPress={() => { void printSheet(invite).catch(() => {}); }}
        style={({ pressed }) => ({ alignSelf: "flex-start", height: 30, paddingHorizontal: 12, borderRadius: 15, justifyContent: "center", backgroundColor: "rgba(20,28,40,0.06)", opacity: pressed ? 0.6 : 1 })}>
        <Text style={{ ...type.caption, fontWeight: "600", color: palette.ink }}>Print</Text>
      </Pressable>}
    </View>
  </View>;
}

/** The QR as one path in modules (medium error correction, so a crease on the printed paper still scans), with a 2-module quiet zone. */
function qrPath(text: string) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), quiet = 2, total = n + quiet * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return { d, total };
}

function Qr({ text, size }: { text: string; size: number }) {
  const { d, total } = qrPath(text);
  return <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`} accessibilityLabel="QR code to join Sona Care">
    <Path d={`M0 0h${total}v${total}H0z`} fill={palette.white} />
    <Path d={d} fill={palette.ink} />
  </Svg>;
}

/** One printed page for the discharge paper: the QR, the code and how to use them. Cancelling the print dialog rejects; nothing to say then. */
function printSheet({ code, link }: { code: string; link: string }) {
  const { d, total } = qrPath(link);
  return printAsync({ html: `<html><body style="font-family:-apple-system,Helvetica,sans-serif;text-align:center;padding:40px;color:#000">
    <p style="font-weight:600;font-size:18px;margin:0">Sona Care</p>
    <svg viewBox="0 0 ${total} ${total}" width="240" height="240" shape-rendering="crispEdges" style="margin:24px auto;display:block"><path d="M0 0h${total}v${total}H0z" fill="#fff"/><path d="${d}" fill="#000"/></svg>
    <p style="font-size:40px;font-weight:700;letter-spacing:6px;margin:0">${code}</p>
    <p style="font-size:16px;margin-top:16px">${SCAN}</p>
  </body></html>` });
}
