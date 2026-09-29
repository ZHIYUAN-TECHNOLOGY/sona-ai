import { Collapsible, Column, Host, Picker, Text as NativeText, TextInput, useNativeState } from "@expo/ui";
import { useEffect, useState, type ReactNode } from "react";
import { View, type KeyboardTypeOptions } from "react-native";
import { Card, Label } from "@/components/sona/ui";
import { palette, type } from "@/components/sona/theme";

export function ClinicalField({ label, value, onChange, multiline = false, keyboardType = "default" }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; keyboardType?: KeyboardTypeOptions }) {
  const text = useNativeState(value);
  useEffect(() => { if (text.value !== value) text.value = value; }, [text, value]);
  return <View style={{ gap: 7 }}><Label muted>{label}</Label><Host matchContents={{ vertical: true }} colorScheme="light" style={{ minHeight: multiline ? 88 : 48 }}><TextInput value={text} onChangeText={onChange} multiline={multiline} keyboardType={keyboardType} placeholder={label} testID={`clinical-${label.toLowerCase().replaceAll(" ", "-")}`} textStyle={{ color: palette.ink, fontSize: 17 }} style={{ padding: 12, backgroundColor: "#EDF0F5", borderRadius: 12 }} /></Host></View>;
}

export function ClinicalChoice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <View style={{ gap: 7 }}><Label muted>{label}</Label><Host matchContents colorScheme="light" seedColor={palette.blue}><Picker selectedValue={value} onValueChange={next => onChange(next as T)}>{options.map(option => <Picker.Item key={option.value} value={option.value} label={option.label} />)}</Picker></Host></View>;
}

export function EvidenceCard({ title, summary, rows, children }: { title: string; summary: string; rows: { label: string; text: string }[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Card label="Illustrative possibilities · unranked" title={title}>
    <Host matchContents colorScheme="light"><Column spacing={12}><NativeText textStyle={{ color: palette.ink, ...type.body }}>{summary}</NativeText><Collapsible label="Evidence & information gaps" isOpen={open} onOpenChange={setOpen} labelStyle={{ color: palette.blue, ...type.body }}><Column spacing={14}>{rows.map(row => <Column key={row.label} spacing={4}><NativeText textStyle={{ color: palette.muted, ...type.footnote, fontWeight: "600" }}>{row.label}</NativeText><NativeText textStyle={{ color: palette.ink, ...type.body }}>{row.text}</NativeText></Column>)}</Column></Collapsible></Column></Host>
    {open && children}
  </Card>;
}
