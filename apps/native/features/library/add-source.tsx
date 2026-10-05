import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { LAYOUT, LAYOUT_SPRING, riseIn } from "@/components/sona/motion";
import { Disclosure, ErrorLine, IconDisc, Mark, Press, TextLink } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type, radius } from "@/components/sona/theme";
import { Action, Expand, glass, Icon, pillStyle, Screen, useAccessibleEffects } from "@/components/sona/ui";
import { JUDGE } from "@/features/live";
import { useAddSource, type Added, type ArticlePreview, type LibraryScope } from "@/features/live/library-sync";
import { haptic } from "@/features/scribe/parts";

/**
 * Route `/library-add`: add a source to the doctor's library, a page pushed from Settings (after 60fps "Speechify Add
 * Document Sheet", https://60fps.design/shots/speechify-add-document-sheet: one row per way in). A page, not a sheet: it
 * has keyboard fields, and opens the camera, "What did you scan?" and Read with OCR, none of which may stack on a sheet.
 * A PDF uploads straight from its row; PubMed and pasted text open in place. While the server reads
 * the source, a status panel unfolds under the rows on the layout spring and pushes nothing off
 * screen (after "Google Photos Logo Spin to Backup Loader Animation",
 * https://60fps.design/shots/google-photos-logo-spin-to-backup-loader-animation), then settles on
 * what was added or why it was refused.
 */
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const SCOPES: { key: LibraryScope; label: string; icon: string; detail: string }[] = [
  { key: "me", label: "Only me", icon: "person.fill", detail: "Only you see it, and only your answers cite it." },
  { key: "hospital", label: "My hospital", icon: "building.2.fill", detail: "Every clinician at your hospital can see and cite it." },
];

type Status = { state: "working"; label: string } | { state: "done"; added: Added } | { state: "refused"; label: string; error: string; retry?: () => void; reason?: string };

export function AddSourceScreen() {
  const [scope, setScope] = useState<LibraryScope>("me");
  const [open, setOpen] = useState<"pubmed" | "paste">();
  const [status, setStatus] = useState<Status>();
  const { reducedMotion } = useAccessibleEffects();
  const add = useAddSource();
  const working = status?.state === "working";

  const submit = async (label: string, write: () => Promise<{ added: Added } | { error: string; retryable: boolean; reason?: string }>) => {
    setStatus({ state: "working", label });
    const result = await write();
    if ("added" in result) { haptic("done"); setOpen(undefined); setStatus({ state: "done", added: result.added }); }
    else { haptic("warn"); setStatus({ state: "refused", label, error: result.error, retry: result.retryable ? () => void submit(label, write) : undefined, reason: result.reason }); }
  };

  // Sona's camera photographs each page and the doctor crops it straight; "What did you scan?" follows.
  const scan = () => { haptic("tap"); router.push({ pathname: "/library-scan", params: { scope } }); };

  const pickPdf = async () => {
    haptic("tap");
    const picked = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true }).catch(() => undefined);
    const file = picked && !picked.canceled ? picked.assets[0] : undefined;
    if (!file) return;
    setOpen(undefined);
    if (file.size && file.size > MAX_PDF_BYTES) { haptic("warn"); setStatus({ state: "refused", label: file.name, error: `This PDF is ${(file.size / 1048576).toFixed(1)} MB. The limit is 10 MB.` }); return; }
    void submit(file.name, () => add.pdf(scope, { uri: file.uri, name: file.name }));
  };

  const rows = [
    <Press key="pdf" onPress={() => void pickPdf()} disabled={working} accessibilityLabel="Upload a PDF" accessibilityHint="Opens Files to choose a PDF"
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, opacity: working ? 0.45 : 1 }}>
      <IconDisc icon="doc.richtext" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, lineHeight: 22, fontWeight: "600", color: palette.ink }}>Upload a PDF</Text>
        <Text style={{ ...type.subhead, color: palette.muted }}>A guideline, protocol or paper, up to 10 MB</Text>
      </View>
      <Icon name="chevron.right" size={12} color={palette.muted} />
    </Press>,
    // Scanned pages can only reach the sample reading until the server has OCR, so the judge build has no scan row.
    !JUDGE && <Press key="scan" onPress={scan} disabled={working} accessibilityLabel="Scan paper pages" accessibilityHint="Opens the camera to photograph pages for OCR"
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, opacity: working ? 0.45 : 1 }}>
      <IconDisc icon="doc.viewfinder" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, lineHeight: 22, fontWeight: "600", color: palette.ink }}>Scan paper pages</Text>
        <Text style={{ ...type.subhead, color: palette.muted }}>Printed guidelines and protocols. X-rays go on the patient's visit</Text>
      </View>
      <Icon name="chevron.right" size={12} color={palette.muted} />
    </Press>,
    <Disclosure key="pubmed" icon="books.vertical" title="From PubMed" detail="A PMID, DOI or PubMed link" open={open === "pubmed"} onToggle={() => setOpen(open === "pubmed" ? undefined : "pubmed")}>
      <PubMedImport disabled={working} preview={add.preview} onAdd={p => void submit(p.title, () => add.article(scope, p.pmid))} />
    </Disclosure>,
    <Disclosure key="paste" icon="text.alignleft" title="Paste text" detail="Lines starting with # become sections" open={open === "paste"} onToggle={() => setOpen(open === "paste" ? undefined : "paste")}>
      <PasteText disabled={working} onAdd={(title, text) => void submit(title, () => add.text(scope, title, text))} />
    </Disclosure>,
  ].filter(row => row !== false);

  // The native title says "Add a source"; the page opens on what adding one does.
  return <Screen>
    <Text style={{ ...type.subhead, color: palette.muted }}>Evidence answers cite it next to PubMed, without grading it.</Text>
    <ScopeToggle value={scope} onChange={setScope} disabled={working} />
    <Animated.View layout={reducedMotion ? undefined : LAYOUT} style={{ borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white, paddingHorizontal: 14 }}>
      {rows.map((row, i) => <Animated.View key={i} entering={reducedMotion ? undefined : riseIn({ delay: 60 + i * 45, distance: 8, duration: 280 })} style={i ? { borderTopWidth: 1, borderColor: glass.hairline } : undefined}>{row}</Animated.View>)}
    </Animated.View>
    {status && <Expand><StatusPanel status={status} scope={scope} onAnother={() => setStatus(undefined)} /></Expand>}
  </Screen>;
}

/**
 * Who the source is for, as a two-way segmented pill (the ward filter's sliding pill, after 60fps
 * "Revolut Number of Transactions Interaction"): the white pill springs to the choice, and the line
 * below says what that choice means.
 */
function ScopeToggle({ value, onChange, disabled }: { value: LibraryScope; onChange: (s: LibraryScope) => void; disabled: boolean }) {
  const { reducedMotion } = useAccessibleEffects();
  const spots = useRef<Partial<Record<LibraryScope, { x: number; w: number }>>>({});
  const x = useSharedValue(0), w = useSharedValue(0);
  const place = (animate: boolean) => {
    const s = spots.current[value];
    if (!s) return;
    const to = (v: number) => animate && !reducedMotion ? withSpring(v, LAYOUT_SPRING) : v;
    x.set(to(s.x)); w.set(to(s.w));
  };
  useEffect(() => place(true), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const pill = useAnimatedStyle(() => ({ left: x.value, width: w.value, opacity: w.value ? 1 : 0 }));
  return <View style={{ gap: 8 }}>
    <View accessibilityRole="tablist" style={{ ...pillStyle, flexDirection: "row", padding: 3, borderRadius: radius.group, borderCurve: "continuous", opacity: disabled ? 0.45 : 1 }}>
      <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 3, bottom: 3, borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white, boxShadow: "0 0 0 0.5px rgba(20,28,40,0.06), 0 2px 8px rgba(40,70,140,0.14)" }, pill]} />
      {SCOPES.map(s => { const on = s.key === value; return <Pressable key={s.key} accessibilityRole="tab" accessibilityState={{ selected: on, disabled }} accessibilityLabel={`${s.label}. ${s.detail}`} disabled={disabled}
        onPress={() => { if (!on) { haptic("tap"); onChange(s.key); } }}
        onLayout={e => { const first = !spots.current[s.key]; spots.current[s.key] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width }; if (on) place(!first); }}
        style={{ flex: 1, minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <Icon name={s.icon} size={13} color={on ? palette.ink : palette.muted} />
        <Text style={{ ...type.footnote, fontWeight: on ? "600" : "500", color: on ? palette.ink : palette.muted }}>{s.label}</Text>
      </Pressable>; })}
    </View>
    <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: palette.muted, paddingHorizontal: 4 }}>{SCOPES.find(s => s.key === value)!.detail}</Text>
  </View>;
}

const field = { borderRadius: radius.control, borderCurve: "continuous", paddingHorizontal: 14, paddingVertical: 12, ...type.body, color: palette.ink, backgroundColor: "rgba(20,28,40,0.05)" } as const;

/** Look the article up first, show what was found, then add: nothing enters the library unseen. */
function PubMedImport({ disabled, preview, onAdd }: { disabled: boolean; preview: ReturnType<typeof useAddSource>["preview"]; onAdd: (p: ArticlePreview) => void }) {
  const [ref, setRef] = useState("");
  const [found, setFound] = useState<ArticlePreview>();
  const [error, setError] = useState<string>();
  const [looking, setLooking] = useState(false);
  const look = async () => {
    setLooking(true); setError(undefined); setFound(undefined);
    const r = await preview(ref.trim());
    setLooking(false);
    if ("preview" in r) setFound(r.preview); else setError(r.error);
  };
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TextInput accessibilityLabel="PMID, DOI or PubMed link" value={ref} onChangeText={t => { setRef(t); setFound(undefined); setError(undefined); }} onSubmitEditing={() => { if (ref.trim()) void look(); }}
        placeholder="e.g. 36942789 or 10.1056/…" placeholderTextColor={palette.placeholder} autoCapitalize="none" autoCorrect={false} returnKeyType="search" editable={!disabled && !looking} style={{ ...field, flex: 1, minHeight: 46 }} />
      <Action label={looking ? "Looking…" : "Look up"} secondary disabled={disabled || looking || !ref.trim()} onPress={() => void look()} />
    </View>
    {error && <ErrorLine text={error} />}
    {found && <Expand style={{ gap: 12 }}>
      <View style={{ gap: 4, padding: 14, borderRadius: radius.control, borderCurve: "continuous", backgroundColor: palette.canvas }}>
        <Text selectable style={{ ...type.callout, fontWeight: "600", color: palette.ink }}>{found.title}</Text>
        <Text style={{ ...type.footnote, color: palette.muted }}>{[found.journal, found.year, `PMID ${found.pmid}`, `${found.sections} abstract part${found.sections === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</Text>
        <TextLink label="Open in PubMed" onPress={() => void Linking.openURL(found.url)} />
      </View>
      <Text style={{ ...type.footnote, color: palette.muted }}>Adds the abstract only. For the full paper, upload its PDF.</Text>
      <Action label="Add this abstract" icon="plus" disabled={disabled} onPress={() => onAdd(found)} />
    </Expand>}
  </View>;
}

function PasteText({ disabled, onAdd }: { disabled: boolean; onAdd: (title: string, text: string) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  return <View style={{ gap: 10 }}>
    <TextInput accessibilityLabel="Source title" value={title} onChangeText={setTitle} placeholder="Title, e.g. Ward CAP protocol" placeholderTextColor={palette.placeholder} maxLength={200} editable={!disabled} style={{ ...field, minHeight: 46 }} />
    <TextInput accessibilityLabel="Source text" value={text} onChangeText={setText} placeholder={"# Antibiotics\nAmoxicillin 1 g three times daily…"} placeholderTextColor={palette.placeholder} multiline maxLength={200_000} editable={!disabled} style={{ ...field, minHeight: 120, maxHeight: 220, textAlignVertical: "top" }} />
    <Action label="Add to library" icon="plus" disabled={disabled || !title.trim() || !text.trim()} onPress={() => onAdd(title.trim(), text.trim())} />
  </View>;
}

/** What the server is doing with the source, then what it added (or why it would not). */
function StatusPanel({ status, scope, onAnother }: { status: Status; scope: LibraryScope; onAnother: () => void }) {
  // A scan is not a dead end: it goes to OCR review (the reading itself is a labelled sample until the model is hosted).
  // The judge build has no sample reading, so there a scanned PDF shows the server's refusal as it is.
  const scan = !JUDGE && status.state === "refused" && status.reason === "no-text";
  const whose = (s: LibraryScope) => s === "me" ? "Only you can cite it." : "Everyone at your hospital can cite it.";
  return <View accessibilityLiveRegion="polite" style={{ gap: 12, padding: 16, borderRadius: radius.group, borderCurve: "continuous", backgroundColor: palette.white }}>
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <View style={{ paddingTop: 1 }}><Mark state={status.state === "working" ? "pending" : status.state === "done" ? "done" : "blocked"} size={22} /></View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={2} style={{ ...type.callout, fontWeight: "600", color: palette.ink }}>{status.state === "done" ? status.added.title : status.label}</Text>
        {status.state === "working" && <Text style={{ ...type.footnote, color: palette.muted }}>Reading it, checking for patient details, cutting it into sections…</Text>}
        {status.state === "done" && <Text style={{ ...type.footnote, color: palette.muted }}>Added {status.added.sections} section{status.added.sections === 1 ? "" : "s"}{status.added.pages ? ` from ${status.added.pages} page${status.added.pages === 1 ? "" : "s"}` : ""}. {whose(status.added.scope)}</Text>}
        {status.state === "refused" && <Text selectable style={{ ...type.footnote, color: scan ? palette.muted : palette.red }}>{scan ? "This PDF is a scan, so there is no text to read directly. OCR can read the pages for you to review." : status.error}</Text>}
      </View>
    </View>
    {status.state === "done" && <View style={{ flexDirection: "row", gap: 10 }}>
      <View style={{ flex: 1 }}><Action label="Done" onPress={() => router.back()} /></View>
      <View style={{ flex: 1 }}><Action label="Add another" secondary onPress={onAnother} /></View>
    </View>}
    {scan && <Action label="Read it with OCR" icon="text.viewfinder" onPress={() => router.push({ pathname: "/library-ocr", params: { title: status.label.replace(/\.pdf$/i, ""), scope } })} />}
    {status.state === "refused" && <View style={{ flexDirection: "row", gap: 16 }}>
      {status.retry && <TextLink label="Try again" onPress={status.retry} />}
      <TextLink label="Choose something else" onPress={onAnother} />
    </View>}
  </View>;
}
