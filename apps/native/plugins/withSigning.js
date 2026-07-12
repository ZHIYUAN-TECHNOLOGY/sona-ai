// Expo config plugin: pin the iOS code-signing team + automatic signing on the app target.
//
// WHY: `expo prebuild` regenerates ios/ and drops the DEVELOPMENT_TEAM, so the next device
// build fails with "No code signing certificates are available to use." Setting it here makes
// signing survive every prebuild — no manual Xcode step. `expo run:ios` passes
// -allowProvisioningUpdates, so automatic signing provisions against this team.
const { withXcodeProject } = require("expo/config-plugins");

const DEVELOPMENT_TEAM = "LTF2YZMF2D"; // ZHIYUAN TECHNOLOGY (MY) SDN. BHD.

module.exports = function withSigning(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const entry = configurations[key];
      if (!entry || typeof entry !== "object" || !entry.buildSettings) continue;
      const bs = entry.buildSettings;
      // App target only (Pods/framework targets have no bundle id).
      if (bs.PRODUCT_BUNDLE_IDENTIFIER == null) continue;
      bs.DEVELOPMENT_TEAM = DEVELOPMENT_TEAM;
      bs.CODE_SIGN_STYLE = "Automatic";
    }
    return cfg;
  });
};
