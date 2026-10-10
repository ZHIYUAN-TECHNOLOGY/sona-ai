import type { Icon as Phosphor, IconWeight } from "phosphor-react-native";
import { View } from "react-native";
import { AlarmIcon } from "phosphor-react-native/src/icons/Alarm";
import { ArrowRightIcon } from "phosphor-react-native/src/icons/ArrowRight";
import { ArrowUpIcon } from "phosphor-react-native/src/icons/ArrowUp";
import { ArrowUpRightIcon } from "phosphor-react-native/src/icons/ArrowUpRight";
import { BellIcon } from "phosphor-react-native/src/icons/Bell";
import { BookIcon } from "phosphor-react-native/src/icons/Book";
import { BookmarkSimpleIcon } from "phosphor-react-native/src/icons/BookmarkSimple";
import { CalendarIcon } from "phosphor-react-native/src/icons/Calendar";
import { CameraIcon } from "phosphor-react-native/src/icons/Camera";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
import { ChatCircleIcon } from "phosphor-react-native/src/icons/ChatCircle";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { CopyIcon } from "phosphor-react-native/src/icons/Copy";
import { ExportIcon } from "phosphor-react-native/src/icons/Export";
import { EyeIcon } from "phosphor-react-native/src/icons/Eye";
import { EyeSlashIcon } from "phosphor-react-native/src/icons/EyeSlash";
import { FileTextIcon } from "phosphor-react-native/src/icons/FileText";
import { HouseIcon } from "phosphor-react-native/src/icons/House";
import { InfoIcon } from "phosphor-react-native/src/icons/Info";
import { KeyboardIcon } from "phosphor-react-native/src/icons/Keyboard";
import { MagnifyingGlassIcon } from "phosphor-react-native/src/icons/MagnifyingGlass";
import { MapPinIcon } from "phosphor-react-native/src/icons/MapPin";
import { MedalIcon } from "phosphor-react-native/src/icons/Medal";
import { MicrophoneIcon } from "phosphor-react-native/src/icons/Microphone";
import { PencilSimpleIcon } from "phosphor-react-native/src/icons/PencilSimple";
import { PhoneIcon } from "phosphor-react-native/src/icons/Phone";
import { PillIcon } from "phosphor-react-native/src/icons/Pill";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import { SparkleIcon } from "phosphor-react-native/src/icons/Sparkle";
import { StarIcon } from "phosphor-react-native/src/icons/Star";
import { StethoscopeIcon } from "phosphor-react-native/src/icons/Stethoscope";
import { ThumbsDownIcon } from "phosphor-react-native/src/icons/ThumbsDown";
import { ThumbsUpIcon } from "phosphor-react-native/src/icons/ThumbsUp";
import { UserIcon } from "phosphor-react-native/src/icons/User";
import { WaveformIcon } from "phosphor-react-native/src/icons/Waveform";
import { XIcon } from "phosphor-react-native/src/icons/X";
import { palette } from "./theme";

/*
 * Sona Care's icons are Phosphor (MIT, phosphor-react-native), as in Sona Pro (apps/native/components/sona/icons.ts):
 * one outline set with a medical range and a duotone weight, so a glyph carries its own soft fill. Deep imports, so
 * only these are bundled; never import from the package root.
 */
const PHOSPHOR = {
  alarm: AlarmIcon, arrowRight: ArrowRightIcon, arrowUp: ArrowUpIcon, arrowUpRight: ArrowUpRightIcon,
  back: CaretLeftIcon, bell: BellIcon, book: BookIcon, calendar: CalendarIcon, camera: CameraIcon, chat: ChatCircleIcon,
  check: CheckIcon, close: XIcon, copy: CopyIcon, doctor: StethoscopeIcon, doc: FileTextIcon, eye: EyeIcon, eyeOff: EyeSlashIcon,
  home: HouseIcon, info: InfoIcon, keyboard: KeyboardIcon, medal: MedalIcon, mic: MicrophoneIcon, next: CaretRightIcon,
  pencil: PencilSimpleIcon, person: UserIcon, phone: PhoneIcon, pill: PillIcon, pin: MapPinIcon, plus: PlusIcon,
  save: BookmarkSimpleIcon, search: MagnifyingGlassIcon, share: ExportIcon, sparkle: SparkleIcon, star: StarIcon, thumbsDown: ThumbsDownIcon,
  thumbsUp: ThumbsUpIcon, voice: WaveformIcon,
} satisfies Record<string, Phosphor>;
export type IconName = keyof typeof PHOSPHOR;

/**
 * One icon by name. Phosphor draws inside a 1/16 margin, so it is scaled up a little to fill its size×size box like the
 * Lucide glyph it replaces; under 16 pt it takes the bold weight to keep its line. `weight` overrides (a key's glyph is
 * duotone, its soft fill gives it body on any disc; a selected tab is fill).
 */
export function Icon({ name, size = 22, color = palette.ink, weight, duotoneColor }: { name: IconName; size?: number; color?: string; weight?: IconWeight; duotoneColor?: string }) {
  const Glyph = PHOSPHOR[name];
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
    <Glyph size={Math.round(size * 1.14)} color={color} weight={weight ?? (size < 16 ? "bold" : "regular")} duotoneColor={duotoneColor} duotoneOpacity={duotoneColor ? 0.28 : undefined} />
  </View>;
}
