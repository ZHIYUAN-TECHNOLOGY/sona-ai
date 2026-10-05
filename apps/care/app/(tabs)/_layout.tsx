import { Tabs } from "expo-router";
import { useEffect } from "react";

/**
 * The dock's four places are real tabs, not stack pages: a tap swaps the page at once (no transition), and a page
 * already visited stays mounted, so switching back is instant and keeps its scroll. They were stack screens before,
 * so every dock tap pushed or popped a page through a 250 ms crossfade and rebuilt it. The tab bar is the app's own
 * floating dock (lib/dock.tsx), so the navigator's bar is hidden; pages are clear over the stack's one canvas.
 * Pages out of sight are frozen, so their clocks and live queries don't re-render.
 */
export default function TabsLayout() {
  // The first open of Medicines and Ask Sona Care also ran their modules (chart, camera, voice): a 415 ms JS block on
  // the tap to Medicines. Once Home has settled they are loaded (about 50-100 ms, with nothing moving), never mounted,
  // so nothing renders or rises in off screen. ponytail: the two screens measured; add others if their first open blocks.
  useEffect(() => {
    const t = setTimeout(() => { require("./dose"); require("../assistant"); }, 2000);
    return () => clearTimeout(t);
  }, []);
  return <Tabs tabBar={() => null} screenOptions={{ headerShown: false, animation: "none", freezeOnBlur: true, sceneStyle: { backgroundColor: "transparent" } }}>
    <Tabs.Screen name="index" />
    <Tabs.Screen name="follow-ups" />
    <Tabs.Screen name="dose" />
    <Tabs.Screen name="doctors" />
  </Tabs>;
}
