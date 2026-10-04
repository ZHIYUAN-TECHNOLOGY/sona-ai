import { router, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { EASE_OUT, LAYOUT } from "@/components/sona/motion";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, glass, Icon, Insight, Screen, Surface, Tone, useAccessibleEffects } from "@/components/sona/ui";
import { BlockerRow, useSettling, Ring } from "@/features/clinical/prescribe-card";
import { Seal, haptic } from "@/features/clinical/medication-parts";
import { BarLine, Decide, FixChip, ModalHeader } from "@/features/discharge";
import { useEncounter } from "@/features/encounter/store";
import { LockedAction, useRole } from "@/features/live/roles";
import { api, errorText, JUDGE, requestId, useLive } from "@/features/live";
import { useServerEncounter } from "@/features/live/sync";
import type { PrescriptionCheck } from "@/features/encounter/types";
import { CODES, EMPTY_CLAIM, INSURER, ORGANISM_UNKNOWN, approveClaim, claimChecks, ivReason, noteFor, withFix, type ClaimState, type Code, type Sentence } from "./model";
import { Arrive, Drafting, SampleLabel } from "@/components/sona/model-answer";
import { keptByText } from "@/components/sona/sample-label";
import { useLiveCodes } from "@/features/live/model-sync";
import { unanswered } from "@/features/clinical/judge-answer";
import { AppealCard, DeniedCard, Paragraph } from "./appeal";
import { NoVisit } from "@/components/sona/no-visit";
import { ErrorLine } from "@/components/sona/parts";

/*
 * Final guarantee letter request, one card. The note sits above its codes; tapping a code glides a
 * soft highlight onto the sentence that justifies it (after Threads' lyric highlight: the block
 * slides on a fast spring, 0.25 s at damping 0.72, and its height follows a touch slower, 0.32 s at
 * 0.8, so it stretches as it moves; other sentences dim). The insurer's gaps are blockers fixed in
 * place, each adding its sentence to the note. Connected, the note is the visit's saved note: the
 * criteria are read against it, a fix saves its sentence to it (the IV reason in the doctor's own
 * words), and with no note saved the card says so. Sending turns every "Required" tag into a check,
 * 90 ms apart on a 200 ms ease-out (after Toss's terms check), then the mock insurer's approval stamps in.
 */
const TEAL = palette.green;
const GLIDE = { duration: 250, dampingRatio: 0.72 }, STRETCH = { duration: 320, dampingRatio: 0.8 };

export function ClaimScreen() {
  const { patient, encounters, updateEncounter } = useEncounter();
  const { reducedMotion } = useAccessibleEffects();
  const encounter = patient ? encounters[patient.id] : undefined;
  const state = encounter?.claim ?? EMPTY_CLAIM;
  const { live, refresh } = useServerEncounter(patient);
  // Connected: the codes and the note sentences they cite come from the server, read from the visit's saved note. The
  // note is read again whenever it may have changed: a fix saved here, or coming back from the note screen.
  const [noteRead, setNoteRead] = useState(0);
  const opened = useRef(false);
  useFocusEffect(useCallback(() => { if (opened.current) setNoteRead(n => n + 1); opened.current = true; }, []));
  const server = useLiveCodes(patient?.encounterId ?? "", String(noteRead));
  // The note is the server's or, in sample mode only, the sample's; connected, nothing stands in for a note that is not saved.
  const note: Sentence[] = server.data?.sentences ?? (live || JUDGE ? [] : noteFor(state));
  // Until the saved note has been read there is nothing to judge: no criterion is shown as open or met, and nothing can be sent.
  const read = !(live || JUDGE) || Boolean(server.data);
  const checks = read ? claimChecks(note) : [];
  const blocked = checks.filter(c => c.status === "blocked");
  const resolving = useSettling(blocked.map(c => c.id));
  const [active, setActive] = useState(CODES[0]!.evidence);
  const [sending, setSending] = useState(false);
  const [why, setWhy] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const { user } = useLive();
  const [serverError, setServerError] = useState<string>();
  const role = useRole();

  if (!patient || !encounter) return <><ModalHeader title="Guarantee letter" /><NoVisit view="claim" what="a guarantee letter" /></>;
  const set = (change: Partial<ClaimState>) => updateEncounter(value => ({ ...value, claim: { ...(value.claim ?? EMPTY_CLAIM), ...change } }));
  // Connected, a fix is a new revision of the visit's saved note (only a doctor writes it), so the letter is built on the
  // note everyone reads. In sample mode the sample note grows on this phone instead (the two switches in the claim's state).
  const addToNote = (fix: Sentence) => {
    if (!role.can("note.save")) { setServerError(role.why("note.save")); return; }
    setServerError(undefined);
    api.note.get({ encounterId: patient.encounterId })
      .then(saved => api.note.save({ encounterId: patient.encounterId, expectedRevision: saved.revision, sentences: withFix(saved.sentences, fix) }))
      .then(() => { setNoteRead(n => n + 1); setActive(fix.id); setWhy(""); })
      .catch(e => setServerError(errorText(e)));
  };
  // Judge build: the note and the codes are the server's or absent, never the authored ones. Its stub's codes are keyword rules over
  // the note it sent (and what the letter would carry), so they stay, said as rules and as the model not answering (features/clinical/judge-answer).
  const held = unanswered(JUDGE, server);
  const codes: (Code & { inTable?: boolean })[] = server.data?.codes ?? (live || JUDGE ? [] : CODES);
  const noNote = Boolean(server.data) && !note.length;
  // The highlight follows a code that is still listed, else the first one.
  const cited = codes.some(c => c.evidence === active) || note.some(s => s.id === active) ? active : codes[0]?.evidence ?? "";
  const rows = checks.filter(c => c.status === "blocked" || resolving.has(c.id));
  const passed = checks.filter(c => c.status === "passed" && !resolving.has(c.id));
  const approved = state.status === "approved";
  const sent = state.status === "sent";
  // The insurer asked a question: the doctor answers in the note and sends again.
  const queried = state.status === "queried";
  // The insurer denied it: the denial and Sona's appeal lead, and this card steps back to the record.
  const denied = state.status === "denied", appealed = state.status === "appealed";

  const send = () => {
    haptic("select"); setSending(true); setServerError(undefined);
    if (live && user) {
      // The server refuses while a criterion is open; once sent, the insurer approves or queries on its review page.
      api.claim.send({ encounterId: patient.encounterId, requestId: requestId(), approvedBy: user.id })
        .then(async () => {
          const first = await api.claim.status({ encounterId: patient.encounterId }).catch(() => undefined);
          set({ status: "sent", reviewUrl: first?.reviewUrl, query: undefined, codedBy: first?.codedBy }); setSending(false);
          const poll = setInterval(() => {
            api.claim.status({ encounterId: patient.encounterId }).then(r => {
              if (r.status === "queried") { clearInterval(poll); set({ status: "queried", query: r.query }); haptic("warning"); return; }
              if (r.status === "denied") { clearInterval(poll); set({ status: "denied", denial: r.denial }); haptic("warning"); return; }
              if (r.status !== "approved") return;
              clearInterval(poll); updateEncounter(value => approveClaim(value, new Date(r.approvedAt ?? Date.now()))); haptic("success");
            }).catch(() => {});
          }, 20_000); // safety net: live updates bring the decision straight away
          timers.current.push(poll as unknown as ReturnType<typeof setTimeout>);
        })
        // A refusal means the server knows something this screen does not: show why and reload its state.
        .catch(e => { setServerError(errorText(e)); setSending(false); void refresh(true).catch(() => {}); });
      return;
    }
    // ponytail: timed mock insurer; the real reply is asynchronous and can decline or ask for more.
    const wait = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, reducedMotion ? 0 : ms));
    wait(900, () => set({ status: "sent" }));
    wait(2300, () => { updateEncounter(value => approveClaim(value, new Date())); setSending(false); haptic("success"); });
  };
  const fix = (check: PrescriptionCheck) => {
    // With no note saved, the one fix is to write it; a sentence is added only to a note that exists.
    if (noNote) return undefined;
    if (check.id === "organism") return <FixChip label="Confirm unknown" icon="checkmark" onPress={() => { if (live) addToNote(ORGANISM_UNKNOWN); else { set({ organismConfirmed: true }); setActive("organism"); } }} />;
    // The reason is the doctor's to give: connected they write it, and those words are what the note and the insurer get.
    if (check.id === "iv") return live ? <View style={{ gap: 8 }}>
      <Paragraph label="Reason for IV antibiotics" placeholder="Why oral was not used first" value={why} onChange={setWhy} />
      {why.trim() !== "" && <FixChip label="Add to note" icon="plus" strong onPress={() => addToNote(ivReason(why))} />}
    </View> : <View style={{ gap: 8 }}>
      <Text style={{ ...type.footnote, color: palette.ink }}>“IV first: vomiting on arrival, unable to keep oral tablets down.”</Text>
      <FixChip label="Add to note" icon="plus" strong onPress={() => { set({ ivReasonAdded: true }); setActive("iv"); }} />
    </View>;
    return undefined;
  };
  const primary = blocked.length ? `Resolve ${blocked.length} to send` : sent ? "Sent · awaiting insurer" : sending ? "Sending…" : queried ? "Send again" : `Send to ${INSURER.toLowerCase()}`;
  const status = approved ? <>Final GL <Tone of="good">approved</Tone></> : sent ? <><Tone of="next">Sent</Tone>, awaiting the insurer</> : queried ? <><Tone of="soon">The insurer asked</Tone> a question</>
    : denied ? <><Tone of="urgent">Denied</Tone> · appeal below</> : appealed ? <><Tone of="next">Appeal sent</Tone>, awaiting the insurer</>
    : !read ? (server.error ? <>The note was not read</> : <>Reading the note</>) : blocked.length ? <><Tone of="soon">{blocked.length} left</Tone> before sending</> : <><Tone of="next">Ready</Tone> to send</>;
  // The decision stays in view. A denied letter's decision is the appeal, which acts in its own review card, so no bar then.
  const bar = approved ? <><BarLine>The discharge's GL check is cleared</BarLine><Action label="Back to discharge" icon="chevron.left" onPress={() => router.back()} /></>
    : denied || appealed ? undefined
    : <>
      {serverError ? <BarLine error>{serverError}</BarLine> : <BarLine>{sent ? "Approval clears the discharge's GL check" : `Sends the note and ${codes.length} ${codes.length === 1 ? "code" : "codes"} to ${INSURER}`}</BarLine>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1 }}>{live && !sent && !role.can("claim.send") ? <LockedAction label="Needs a doctor to send" path="claim.send" />
          : <Decide label={primary} icon={blocked.length ? undefined : sent ? "hourglass" : "paperplane"} muted={blocked.length > 0 || sent || !read} disabled={blocked.length > 0 || sending || sent || !read} onPress={send} />}</View>
      </View>
    </>;

  return <Screen bottom={bar}>
    <ModalHeader title="Guarantee letter" />

    {(denied || appealed) && state.denial && <>
      <DeniedCard denial={state.denial} />
      <AppealCard key={state.denial.at} patient={patient} state={{ ...state, denial: state.denial }} onChange={set}
        onApproved={() => { updateEncounter(value => approveClaim(value, new Date())); haptic("success"); }} />
    </>}

    <Surface feature={!denied && !appealed} layout={reducedMotion ? undefined : LAYOUT} style={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Ring done={approved ? checks.length : checks.length - blocked.length} total={checks.length || 1} />
        <View style={{ flex: 1, gap: 4 }}>
          <Insight eyebrow={`${patient.name} · ${INSURER}`}>{status}</Insight>
          {serverError && !bar && <Text style={{ ...type.footnote, color: palette.red }}>{serverError}</Text>}
        </View>
      </View>

      {!approved && !sending && !sent && rows.length > 0 && <Animated.View layout={reducedMotion ? undefined : LAYOUT}>
        {rows.map((check, i) => <BlockerRow key={check.id} check={check} n={i + 1} resolved={resolving.has(check.id)}>{fix(check)}</BlockerRow>)}
      </Animated.View>}

      {!approved && !sending && !sent && passed.length > 0 && <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="checkmark.circle.fill" size={13} color={TEAL} />
        <Text style={{ ...type.footnote, fontWeight: "600", color: TEAL }}>{blocked.length ? `${passed.length} insurer criteria met` : `All ${passed.length} insurer criteria met`}</Text>
      </Animated.View>}

      {queried && state.query && <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(200)} style={{ gap: 4, padding: 12, borderRadius: radius.control, borderCurve: "continuous", backgroundColor: "rgba(196,120,20,0.1)" }}>
        <Text style={{ ...type.overline, color: palette.amber }}>The insurer asks</Text>
        <Text selectable style={{ ...type.subhead, color: palette.ink }}>{state.query}</Text>
      </Animated.View>}

      {sent && state.reviewUrl && <Pressable accessibilityRole="link" accessibilityLabel="Open the insurer's review page" hitSlop={8} onPress={() => { void WebBrowser.openBrowserAsync(state.reviewUrl!).catch(() => {}); }} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: palette.blue }}>Insurer's review page</Text>
        <Icon name="arrow.up.right" size={10} color={palette.blue} />
      </Pressable>}

      {(sending || sent) && !approved && <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(160)} exiting={reducedMotion ? undefined : FadeOut.duration(160)} style={{ gap: 2 }}>
        {checks.map((c, i) => <Criterion key={c.id} label={c.label} index={i} />)}
      </Animated.View>}

      {approved && <Animated.View entering={reducedMotion ? FadeIn : FadeIn.duration(260)} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.group, borderCurve: "continuous", backgroundColor: "rgba(15,110,102,0.08)" }}>
        <Seal stampDelay={reducedMotion ? undefined : 120} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.subhead, fontWeight: "700", color: palette.ink }}>Final GL approved</Text>
          <Text style={{ ...type.caption, color: palette.muted }}>Discharge no longer waits on the insurer · {new Date(state.approvedAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {live ? "approved on the insurer's page" : "mock insurer"}</Text>
        </View>
      </Animated.View>}

      {/* The record behind the letter: quieter, under what blocks it. */}
      <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 16, paddingTop: 14, borderTopWidth: 1, borderColor: glass.hairline }}>
      {note.length > 0 && <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 8 }}>
        <Text style={{ ...type.overline, color: palette.muted }}>Evidence in the note</Text>
        <Evidence note={note} active={cited} />
      </Animated.View>}
      {noNote && <View style={{ gap: 8 }}>
        <Text style={{ ...type.overline, color: palette.muted }}>Evidence in the note</Text>
        <Text style={{ ...type.footnote, color: palette.amber }}>No note saved for this visit yet. The codes and the insurer's criteria are read from it, so save the note first.</Text>
        <FixChip label="Open the note" icon="doc.text" strong onPress={() => router.push("/note")} />
      </View>}

      <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ gap: 2 }}>
        <Text style={{ ...type.overline, color: palette.muted, paddingBottom: 6 }}>Codes · tap to see why</Text>
        {server.loading && <Drafting label="Coding the note…" style={{ paddingVertical: 6 }} />}
        {server.data && !codes.length && !noNote && <Text style={{ ...type.footnote, color: palette.amber }}>No codable diagnosis in the note yet</Text>}
        {/* After a fix the previous codes stay on view while the new note is coded (`stale`), and say so; a failure says which codes these are. */}
        {server.stale && !server.error && <Drafting label="Coding the note again…" lines={0} />}
        {server.error && <ErrorLine text={`${held ? "No codes: " : ""}${server.error}${server.stale ? " · showing the codes from before the change" : JUDGE ? "" : " · showing the authored codes"}`} onRetry={server.retry} />}
        {held?.why === "stub" && !noNote && <ErrorLine text={`${held.reason} · codes by keyword rule over the note`} onRetry={server.retry} />}
        {!server.loading && codes.map((c, i) => { const on = c.evidence === cited; return <Arrive key={c.code} index={i} animate={Boolean(server.data)}><Pressable accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${c.code}, ${c.label}, ${c.kind}${c.inTable === false ? ", not in the ICD-10 table" : ""}`}
          onPress={() => { haptic("select"); setActive(c.evidence); }} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 }}>
          <Animated.View style={{ width: 58, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: on ? palette.blue : "rgba(20,28,40,0.06)", transitionProperty: "backgroundColor", transitionDuration: 180 } as never}>
            <Animated.Text lineBreakStrategyIOS="push-out" style={{ ...type.footnote, fontWeight: "700", color: on ? palette.white : palette.ink, fontVariant: ["tabular-nums"], transitionProperty: "color", transitionDuration: 180 } as never}>{c.code}</Animated.Text>
          </Animated.View>
          <Text numberOfLines={1} style={{ ...type.subhead, flex: 1, color: palette.ink }}>{c.label}</Text>
          <Text style={{ ...type.caption, color: c.inTable === false ? palette.amber : palette.muted }}>{c.inTable === false ? "Not in ICD-10 table" : c.kind}</Text>
        </Pressable></Arrive>; })}
        {!held?.reason && !noNote && <SampleLabel answer={server} rule what="coding" />}
        {/* Once a letter has gone: who suggested the codes frozen into it, which the label above (the codes as suggested now) does not say. */}
        {state.status !== "draft" && keptByText(state.codedBy, "suggested by") && <Text style={{ ...type.caption, color: palette.muted }}>Codes as sent · {keptByText(state.codedBy, "suggested by")}</Text>}
      </Animated.View>
      </Animated.View>
    </Surface>
  </Screen>;
}

/** The note as sentences with one soft highlight that glides to the active sentence and stretches to fit it. */
function Evidence({ note, active }: { note: Sentence[]; active: string }) {
  const { reducedMotion } = useAccessibleEffects();
  const frames = useRef<Record<string, { y: number; h: number }>>({});
  const top = useSharedValue(0), height = useSharedValue(0), shown = useSharedValue(0);
  const place = (animate: boolean) => {
    const f = frames.current[active];
    if (!f) return;
    const pad = 4;
    if (!animate || reducedMotion || !shown.value) { top.set(f.y - pad); height.set(f.h + pad * 2); shown.set(withTiming(1, { duration: 180 })); return; }
    top.set(withSpring(f.y - pad, GLIDE)); height.set(withSpring(f.h + pad * 2, STRETCH));
  };
  useEffect(() => place(true), [active]);
  const block = useAnimatedStyle(() => ({ opacity: shown.value, height: height.value, transform: [{ translateY: top.value }] }));
  return <View>
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: -8, right: -8, top: 0, borderRadius: 10, borderCurve: "continuous", backgroundColor: "rgba(36,91,204,0.10)" }, block]} />
    {note.map(s => <Animated.View key={s.id} entering={reducedMotion ? undefined : FadeIn.duration(220)} onLayout={e => { const { y, height: h } = e.nativeEvent.layout; frames.current[s.id] = { y, h }; if (s.id === active) place(false); }} style={{ paddingVertical: 4 }}>
      {/* No per-word colour: the highlight on the sentence behind the chosen code is the one that means something. */}
      <Animated.Text selectable lineBreakStrategyIOS="push-out" style={{ ...type.subhead, color: s.id === active ? palette.ink : palette.muted, transitionProperty: "color", transitionDuration: 200 } as never}>{s.text}</Animated.Text>
    </Animated.View>)}
  </View>;
}

/** One criterion at send time: its "Required" tag turns into a check, staggered by its index. */
function Criterion({ label, index }: { label: string; index: number }) {
  const { reducedMotion } = useAccessibleEffects();
  const p = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => { if (!reducedMotion) p.set(withDelay(120 + index * 90, withTiming(1, { duration: 200, easing: EASE_OUT }))); }, [p, index, reducedMotion]);
  const tag = useAnimatedStyle(() => ({ opacity: 1 - p.value, transform: [{ scale: 1 - p.value * 0.3 }] }));
  const check = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: 0.6 + p.value * 0.4 }] }));
  return <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 34 }}>
    <Text style={{ ...type.subhead, color: palette.ink }}>{label}</Text>
    <View style={{ width: 70, height: 22, alignItems: "flex-end", justifyContent: "center" }}>
      <Animated.View style={[{ position: "absolute", right: 0, paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: "center", backgroundColor: "rgba(196,120,20,0.12)" }, tag]}>
        <Text style={{ ...type.caption, fontWeight: "700", color: palette.amber }}>Required</Text>
      </Animated.View>
      <Animated.View style={[{ position: "absolute", right: 0, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: TEAL }, check]}>
        <Icon name="checkmark" size={11} color={palette.white} />
      </Animated.View>
    </View>
  </View>;
}

