import type { ConfigContext, ExpoConfig } from "expo/config";

// APP_VARIANT=development builds a separate "Sona dev" app (its own bundle ID), so a development build
// with native modules such as Vision Camera installs beside the release app instead of replacing it.
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (process.env.APP_VARIANT !== "development") return base;
  return { ...base, name: "Sona dev", ios: { ...base.ios, bundleIdentifier: "ai.zhiyuantech.sona.dev" }, android: { ...base.android, package: "com.anonymous.sonaai.dev" } };
};
