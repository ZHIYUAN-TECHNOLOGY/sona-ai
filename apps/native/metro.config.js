// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Alchemy writes runtime state here; block it to avoid Metro refresh loops.
const blockList = config.resolver.blockList ?? [];
const blockListPatterns = Array.isArray(blockList) ? blockList : [blockList];

config.resolver.blockList = [
  ...blockListPatterns,
  /[/\\]packages[/\\]infra[/\\]\.alchemy(?:[/\\]|$)/,
];

// Bundle audio assets (spike sample consult clip) as binary assets.
if (!config.resolver.assetExts.includes("wav")) {
  config.resolver.assetExts.push("wav");
}

module.exports = config;
