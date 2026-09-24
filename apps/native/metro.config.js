const { withVarlockMetroConfig } = require("@varlock/expo-integration/metro-config");
// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Alchemy writes runtime state here; block it to avoid Metro refresh loops.
const blockList = config.resolver.blockList ?? [];
const blockListPatterns = Array.isArray(blockList) ? blockList : [blockList];

config.resolver.blockList = [
  ...blockListPatterns,
  /[/\\]packages[/\\]infra[/\\]\.alchemy(?:[/\\]|$)/,
  // Agent worktrees carry their own node_modules; resolving from them breaks native module lookup.
  /[/\\]\.claude[/\\]worktrees[/\\]/,
];

module.exports = withVarlockMetroConfig(config);
