import { router } from "expo-router";
import { Alert, View } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import { LAYOUT, riseIn } from "@/components/sona/motion";
import { ErrorLine, IconDisc, Press } from "@/components/sona/parts";
import { Text } from "@/components/sona/text";
import { palette, type } from "@/components/sona/theme";
import { Action, Body, Card, glass, Icon, useAccessibleEffects } from "@/components/sona/ui";
import { useLiveLibrary, type LibraryDocument } from "@/features/live/library-sync";

const KIND_ICON: Record<LibraryDocument["kind"], string> = { pdf: "doc.richtext", pubmed: "books.vertical", text: "text.alignleft" };

/**
 * Live mode: the sources evidence answers cite beside PubMed. The doctor's own (private by default)
 * and the hospital's shared ones, each saying whose it is; adding goes through the `/library-add` sheet.
 */
export function LibraryCard() {
  const { live, docs, error, pending, remove } = useLiveLibrary();
  const { reducedMotion } = useAccessibleEffects();
  if (!live) return null;
  const confirmRemove = (d: LibraryDocument) => Alert.alert("Remove this source?", `${d.title} will no longer be cited in ${d.scope === "me" ? "your" : "anyone's"} evidence answers.`, [
    { text: "Keep", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => { void remove(d.id); } },
  ]);
  return <Card label="Library" title="Your sources">
    <Body muted>Evidence answers cite these next to PubMed. Yours stay private unless you share them with your hospital.</Body>
    {docs && docs.length > 0 && <View>
      {docs.map((d, i) => <Animated.View key={d.id} layout={reducedMotion ? undefined : LAYOUT} entering={reducedMotion ? undefined : riseIn({ delay: i * 35, distance: 6, duration: 260 })} exiting={reducedMotion ? undefined : FadeOut.duration(160)}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: glass.hairline }}>
        <IconDisc icon={KIND_ICON[d.kind]} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={2} style={{ ...type.callout, fontWeight: "600", color: palette.ink }}>{d.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <ScopeBadge scope={d.scope} />
            <Text numberOfLines={1} style={{ ...type.caption, color: palette.muted, flexShrink: 1 }}>{d.sections} section{d.sections === 1 ? "" : "s"} · {d.source} · {d.year}</Text>
          </View>
        </View>
        <Press onPress={() => confirmRemove(d)} disabled={pending} scale={0.9} accessibilityLabel={`Remove ${d.title}`} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: pending ? 0.45 : 1 }}>
          <Icon name="trash" size={16} color={palette.muted} />
        </Press>
      </Animated.View>)}
    </View>}
    {docs && !docs.length && <Body muted>No sources yet. Add a guideline, protocol or paper you trust.</Body>}
    <Action label="Add a source" icon="plus" onPress={() => router.push("/library-add")} />
    {error && <ErrorLine text={error} />}
  </Card>;
}

/** Whose a source is, in the smallest words: a person glyph for the doctor's own, a building for the hospital's. */
function ScopeBadge({ scope }: { scope: LibraryDocument["scope"] }) {
  const mine = scope === "me";
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: mine ? "rgba(36,91,204,0.1)" : "rgba(20,28,40,0.06)" }}>
    <Icon name={mine ? "person.fill" : "building.2.fill"} size={10} color={mine ? palette.blue : palette.muted} />
    <Text style={{ ...type.caption, fontWeight: "600", color: mine ? palette.blue : palette.muted }}>{mine ? "Only you" : "Hospital"}</Text>
  </View>;
}
