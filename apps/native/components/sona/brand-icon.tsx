import { SvgXml } from "react-native-svg";
import { palette } from "./theme";

/**
 * Sona's control icons: Solar "line duotone" (Iconify, CC BY 4.0) — soft rounded strokes with a
 * half-opacity secondary layer, calm enough for clinical use and matched to the glass orb.
 * One set for the dock and composer; SF Symbols remain for in-content icons.
 */
const paths = {
  keyboard: '<path d="M2 11C2 8.17157 2 6.75736 2.87868 5.87868C3.75736 5 5.17157 5 8 5H16C18.8284 5 20.2426 5 21.1213 5.87868C22 6.75736 22 8.17157 22 11V13C22 15.8284 22 17.2426 21.1213 18.1213C20.2426 19 18.8284 19 16 19H8C5.17157 19 3.75736 19 2.87868 18.1213C2 17.2426 2 15.8284 2 13V11Z"/><path d="M7 16H17" opacity=".5"/><path stroke-linejoin="round" d="M6 9H6.0001M9 9H9.0001M12 9H12.0001M15 9H15.0001M18 9H18.0001M18 12H18.0001M15 12H15.0001M12 12H12.0001M9 12H9.0001M6 12H6.0001" opacity=".5"/>',
  add: '<circle cx="12" cy="12" r="10" opacity=".5"/><path d="M15 12L12 12M12 12L9 12M12 12L12 9M12 12L12 15"/>',
  close: '<circle cx="12" cy="12" r="10" opacity=".5"/><path d="M14.5 9.50002L9.5 14.5M9.49998 9.5L14.5 14.5"/>',
  mic: '<path d="M7 8C7 5.23858 9.23858 3 12 3C14.7614 3 17 5.23858 17 8V11C17 13.7614 14.7614 16 12 16C9.23858 16 7 13.7614 7 11V8Z"/><path d="M11 8H13M10 11L14 11" opacity=".5"/><path d="M20 10V11C20 15.4183 16.4183 19 12 19M4 10V11C4 15.4183 7.58172 19 12 19M12 19V22" opacity=".5"/>',
  image: '<path d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z"/><circle cx="16" cy="8" r="2" opacity=".5"/><path d="M2 12.5001L3.75159 10.9675C4.66286 10.1702 6.03628 10.2159 6.89249 11.0721L11.1822 15.3618C11.8694 16.0491 12.9512 16.1428 13.7464 15.5839L14.0446 15.3744C15.1888 14.5702 16.7369 14.6634 17.7765 15.599L21 18.5001" opacity=".5"/>',
  wave: '<path d="M12 4L12 20M20 11L20 13M4 11L4 13"/><path d="M16 7L16 17M8 7L8 17" opacity=".5"/>',
  note: '<path d="M3 10C3 6.22876 3 4.34315 4.17157 3.17157C5.34315 2 7.22876 2 11 2H13C16.7712 2 18.6569 2 19.8284 3.17157C21 4.34315 21 6.22876 21 10V14C21 17.7712 21 19.6569 19.8284 20.8284C18.6569 22 16.7712 22 13 22H11C7.22876 22 5.34315 22 4.17157 20.8284C3 19.6569 3 17.7712 3 14V10Z" opacity=".5"/><path d="M8 12H16M8 8H16M8 16H13"/>',
  send: '<path stroke-linejoin="round" d="M12 20L12 4M6 10L12 4L18 10"/>',
} as const;

export type BrandIconName = keyof typeof paths;

const xml = (name: BrandIconName, color: string, width: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="${color}" stroke-linecap="round" stroke-width="${width}">${paths[name]}</g></svg>`;

export function BrandIcon({ name, size = 22, color = palette.ink, strokeWidth = 1.5 }: { name: BrandIconName; size?: number; color?: string; strokeWidth?: number }) {
  return <SvgXml xml={xml(name, color, strokeWidth)} width={size} height={size} accessibilityElementsHidden importantForAccessibility="no" />;
}
