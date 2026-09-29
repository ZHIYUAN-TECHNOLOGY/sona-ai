import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, TextInput, View, type TextStyle } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Arrive, Drafting } from "@/components/sona/model-answer";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { ErrorLine } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Icon, Surface, useAccessibleEffects } from "@/components/sona/ui";
import { haptic } from "@/features/clinical/medication-parts";
import type { Patient } from "@/features/encounter/types";
import { api, errorText, requestId, useLive } from "@/features/live";
import { useLiveAppeal } from "@/features/live/model-sync";
import { LockedAction, useRole } from "@/features/live/roles";
import { DENIAL_REASONS, INSURER, appealByRules, noteFor, type AppealLetter, type ClaimState, type Denial, type Sentence } from "./model";

/*
 * The insurer denied the final guarantee letter: a red card says so and why, and Sona's appeal sits
 * under it for the doctor to check, edit and send. The appeal card is the inbox's drafted-reply card
 * (after 60fps "Wabi Chat Suggestion Swipe Cards Carousel Interaction"): it rises in above the action
 * with a blue kicker. While the server drafts, soft bars breathe (Monogram Pulse Sweep); then the
 * letter reveals in stages, the opening, each point, then the closing, 70 ms apart (Arrive).
 * Reduce Motion: it simply appears. Every point carries a "From the note" pill that opens the note
 * sentence it cites, so nothing in the letter is unsourced.
 */
const RED = palette.red;
const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** "Denied by Synthetic insurer · <reason>", when, and the insurer's own words if they added any. */
export function DeniedCard({ denial }: { denial: Denial }) {
  const { reducedMotion } = useAccessibleEffects();
  const title = `Denied by ${INSURER} · ${denial.reason}`;
  return <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(220)} accessible accessibilityLabel={`${title}. ${clock(denial.at)}${denial.note ? `. ${denial.note}` : ""}`}
    style={{ flexDirection: "row", gap: 12, padding: 14, borderRadius: 20, borderCurve: "continuous", backgroundColor: "rgba(162,62,62,0.09)", borderWidth: 1, borderColor: "rgba(162,62,62,0.14)" }}>
    <Icon name="xmark.octagon.fill" size={20} color={RED} />
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={{ ...type.subhead, fontWeight: "700", color: RED }}>{title}</Text>
      <Text style={{ ...type.caption, color: palette.muted }}>{clock(denial.at)} · the discharge waits on this letter</Text>
      {denial.note && <Text selectable style={{ ...type.footnote, color: palette.ink }}>“{denial.note}”</Text>}
    </View>
  </Animated.View>;
}

type Draft = { letter: AppealLetter; sentences: Sentence[]; source: "fixture" | "model"; model?: string };

/**
 * Sona's appeal for a denied letter. Live mode drafts on the server (claim.appealDraft); fixture mode
 * uses the same authored rules over the claim's note. Sending needs a doctor or management; once
 * sent the card reads "Appeal sent · awaiting insurer" with the insurer's fresh review link.
 */
export function AppealCard({ patient, state, onChange, onApproved }: { patient: Patient; state: ClaimState & { denial: Denial }; onChange: (change: Partial<ClaimState>) => void; onApproved: () => void }) {
  const { on: live, user } = useLive();
  const role = useRole();
  const { reducedMotion } = useAccessibleEffects();
  const appealed = state.status === "appealed";
  const server = useLiveAppeal(patient.encounterId, live && role.can("claim.appealDraft") && !appealed ? state.denial.at : undefined);
  const local: Draft | undefined = live ? undefined : (() => {
    const sentences = noteFor(state);
    const letter = appealByRules({ denialCode: state.denial.code, denialReason: state.denial.reason, sentences, patient });
    return { letter, sentences: sentences.filter(s => letter.points.some(p => p.evidenceSentenceId === s.id)), source: "fixture" };
  })();
  const draft: Draft | undefined = live ? server.data : local;
  const [edited, setEdited] = useState<AppealLetter>();
  const letter = edited ?? draft?.letter;
  const [sendId, setSendId] = useState(requestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const edit = (change: (l: AppealLetter) => AppealLetter) => { if (letter) setEdited(change(letter)); };
  const ready = Boolean(letter && letter.opening.trim() && letter.closing.trim() && letter.points.length && letter.points.every(p => p.claim.trim()));
  const send = () => {
    if (!letter || !ready || busy) return;
    haptic("select"); setBusy(true); setError(undefined);
    const sent = (appealedAt: string, reviewUrl?: string) => {
      onChange({ status: "appealed", appealedAt, reviewUrl }); setBusy(false); haptic("success");
      AccessibilityInfo.announceForAccessibility(`Appeal sent to ${INSURER}`);
    };
    if (live && user) {
      api.claim.appeal({ encounterId: patient.encounterId, requestId: sendId, approvedBy: user.id, letter })
        .then(async () => { const s = await api.claim.status({ encounterId: patient.encounterId }).catch(() => undefined); sent(s?.appealedAt ?? new Date().toISOString(), s?.reviewUrl); })
        .catch(e => { setError(errorText(e)); setBusy(false); setSendId(requestId()); });
      return;
    }
    // ponytail: fixture mode's insurer approves the appeal after a pause, as the GL send's mock insurer does.
    sent(new Date().toISOString());
    timers.current.push(setTimeout(onApproved, reducedMotion ? 0 : 2300));
  };

  if (appealed) return <Surface feature layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 16, gap: 10 }}>
    <View accessible style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Icon name="hourglass" size={16} color={palette.blue} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>Appeal sent · awaiting insurer</Text>
        <Text style={{ ...type.caption, color: palette.muted }}>{state.appealedAt ? `${clock(state.appealedAt)} · ` : ""}{live ? `${INSURER} reviews it on a new link` : "mock insurer"}</Text>
      </View>
    </View>
    {state.reviewUrl && <Pressable accessibilityRole="link" accessibilityLabel="Open the insurer's review page" hitSlop={12} onPress={() => { void WebBrowser.openBrowserAsync(state.reviewUrl!).catch(() => {}); }}
      style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Insurer's review page</Text>
      <Icon name="arrow.up.right" size={10} color={palette.blue} />
    </Pressable>}
  </Surface>;

  return <Animated.View layout={reducedMotion ? undefined : LAYOUT} entering={reducedMotion ? FadeIn.duration(150) : riseIn({ distance: 10, duration: 360 })}>
    <Surface feature style={{ padding: 16, gap: 12 }}>
      <Text style={{ ...type.overline, color: palette.blue }}>Sona drafted an appeal · check before sending</Text>
      {live && !role.can("claim.appealDraft") ? <Text style={{ ...type.footnote, color: palette.muted }}>{role.why("claim.appealDraft")}</Text>
        : server.error ? <ErrorLine text={`No draft: ${server.error}`} />
        : !letter || !draft ? <Drafting label="Sona is drafting the appeal…" />
        : <>
          <Arrive index={0}><Paragraph label="Opening paragraph" value={letter.opening} onChange={opening => edit(l => ({ ...l, opening }))} /></Arrive>
          {letter.points.map((p, i) => {
            const sentence = draft.sentences.find(s => s.id === p.evidenceSentenceId);
            return <Arrive key={p.evidenceSentenceId} index={i + 1} style={{ flexDirection: "row", gap: 10 }}>
              <Text style={{ ...type.callout, fontWeight: "700", color: palette.blue, paddingTop: 10, fontVariant: ["tabular-nums"] }}>{i + 1}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Paragraph label={`Point ${i + 1}`} value={p.claim} onChange={claim => edit(l => ({ ...l, points: l.points.map((x, j) => j === i ? { ...x, claim } : x) }))} />
                {sentence && <FromTheNote patientId={patient.id} sentence={sentence} />}
              </View>
            </Arrive>;
          })}
          <Arrive index={letter.points.length + 1}><Paragraph label="Closing paragraph" value={letter.closing} onChange={closing => edit(l => ({ ...l, closing }))} /></Arrive>
          <Arrive index={letter.points.length + 2} style={{ gap: 10 }}>
            <Text selectable style={{ ...type.caption, color: palette.muted }}>{draft.source === "fixture" ? "Sample draft · appeal model not switched on yet" : `Drafted by ${draft.model ?? "a model"}`}</Text>
            <Text style={{ ...type.footnote, color: palette.ink }}>Goes to {INSURER} with a new review link, {letter.points.length} {letter.points.length === 1 ? "point" : "points"} from the note{user?.name ? ` · approved by ${user.name}` : ""}.</Text>
            {error && <Text style={{ ...type.footnote, color: RED }}>Not sent: {error}</Text>}
            {live && !role.can("claim.appeal") ? <LockedAction label="Needs a doctor or management to send" path="claim.appeal" height={46} />
              : <Action label={busy ? "Sending…" : "Send appeal"} icon="paperplane" disabled={!ready || busy} accessibilityLabel={`Send appeal to ${INSURER}`} onPress={send} />}
          </Arrive>
        </>}
    </Surface>
  </Animated.View>;
}

/**
 * Settings' demo control: the synthetic insurer denies the demo patient's letter ("Admission not
 * medically necessary"), for rehearsal. Live mode posts the insurer's own review form, so the denial
 * lands exactly as the web page would make it (stored, announced); fixture mode denies in the app.
 */
export async function insurerDenies(live: boolean, encounterId: string, deny: (denial: Denial) => void) {
  const { code, reason } = DENIAL_REASONS.find(d => d.code === "MED")!;
  if (!live) { deny({ code, reason, at: new Date().toISOString() }); return; }
  const { reviewUrl } = await api.claim.status({ encounterId });
  if (!reviewUrl) throw new Error("Send the guarantee letter first: the insurer can only deny a letter it has.");
  const res = await fetch(reviewUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ decision: "deny", reason: code, note: "" }).toString() });
  if (!res.ok) throw new Error(`The insurer page refused (${res.status})`);
}

/** One paragraph of the letter, edited in place: it reads as text, with a faint field behind it. */
function Paragraph({ label, value, onChange }: { label: string; value: string; onChange: (text: string) => void }) {
  const [focused, setFocused] = useState(false);
  return <TextInput value={value} onChangeText={onChange} multiline scrollEnabled={false} maxLength={1000} accessibilityLabel={label} accessibilityHint="Edit before sending"
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={{ ...type.callout, color: palette.ink, minHeight: 44, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 10, borderRadius: 12, borderCurve: "continuous", borderWidth: 1,
      borderColor: focused ? "rgba(36,91,204,0.35)" : "transparent", backgroundColor: focused ? "rgba(255,255,255,0.9)" : "rgba(20,28,40,0.035)" } as TextStyle} />;
}

/** The small source pill under a point: opens the exact note sentence it cites in the source sheet. */
function FromTheNote({ patientId, sentence }: { patientId: string; sentence: Sentence }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`From the note: ${sentence.text}`} accessibilityHint="Opens the note sentence this point cites" hitSlop={{ top: 8, bottom: 8, left: 4, right: 12 }}
    onPress={() => { haptic("select"); router.push({ pathname: "/source", params: { id: "note", patientId, quote: sentence.text } }); }}
    style={({ pressed }) => ({ alignSelf: "flex-start", marginLeft: 10, flexDirection: "row", alignItems: "center", gap: 5, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: "#E6EEFC", opacity: pressed ? 0.7 : 1 })}>
    <Icon name="doc.text" size={11} color={palette.blue} />
    <Text style={{ ...type.caption, fontWeight: "600", color: palette.blue }}>From the note</Text>
  </Pressable>;
}
