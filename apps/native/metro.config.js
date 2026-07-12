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

// Bundle audio assets (spike sample consult clip) + on-device model weights as binary assets.
// .bin = the Malaysian Whisper ggml shipped in the app (offline STT, nothing downloads/leaves).
for (const ext of ["wav", "bin"]) {
  if (!config.resolver.assetExts.includes(ext)) config.resolver.assetExts.push(ext);
}

module.exports = config;
