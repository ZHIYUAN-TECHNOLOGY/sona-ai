// iOS 27 asserts at launch unless the app adopts the UIScene life cycle (Expo Go already does).
// Declare Expo's scene delegate and let it create the window and start React Native, instead of
// the app delegate's legacy `window = UIWindow(frame:)` + `startReactNative` block.
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: "EXExpoAppSceneDelegate" },
        ],
      },
    };
    return mod;
  });
  return withAppDelegate(config, (mod) => {
    let src = mod.modResults.contents;
    if (mod.modResults.language !== "swift" || src.includes("ExpoReactNativeFactoryProvider")) return mod;
    const declared = src.replace("class AppDelegate: ExpoAppDelegate {", "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {");
    const startup = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;
    if (declared === src || !startup.test(declared)) {
      throw new Error("with-scene-lifecycle: AppDelegate.swift no longer matches the expected Expo template; update the plugin.");
    }
    mod.modResults.contents = declared.replace(startup, "\n    // The scene delegate (EXExpoAppSceneDelegate) creates the window and starts React Native.\n");
    return mod;
  });
};
