// Expo config plugin: add the `-ObjC` linker flag to the iOS app target.
//
// WHY: third-party Fabric view components (react-native-enriched-markdown,
// react-native-svg, @shopify/react-native-skia) ship their view classes in STATIC
// libraries and are registered in RCTThirdPartyComponentsProvider via
// `NSClassFromString("<Name>")` — a runtime string lookup with no compile-time
// reference. Without `-ObjC`, the linker dead-strips those ObjC classes from the app
// binary (they're in the .a but not the final executable), so `NSClassFromString`
// returns nil at runtime and RN renders "Unimplemented component: <Name>".
//
// `-ObjC` forces the linker to load every ObjC class/category from static libs, keeping
// the Fabric component classes alive so they register. This fixes enriched-markdown AND
// unblocks svg / skia in this Expo-precompiled RN setup.
const { withXcodeProject } = require("expo/config-plugins");

const FLAG = "-ObjC";

module.exports = function withObjcLinker(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const entry = configurations[key];
      if (!entry || typeof entry !== "object" || !entry.buildSettings) continue;
      const bs = entry.buildSettings;
      // Only the app target's build configs (Pods/framework targets have no bundle id).
      if (bs.PRODUCT_BUNDLE_IDENTIFIER == null) continue;

      let flags = bs.OTHER_LDFLAGS;
      if (flags == null) flags = ['"$(inherited)"'];
      if (typeof flags === "string") flags = [flags];
      const has = flags.some((f) => String(f).replace(/"/g, "") === FLAG);
      if (!has) flags.push(`"${FLAG}"`);
      bs.OTHER_LDFLAGS = flags;
    }
    return cfg;
  });
};
