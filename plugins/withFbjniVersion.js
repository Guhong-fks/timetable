const { withProjectBuildGradle } = require('@expo/config-plugins');

const MARKER = '// course-table-app: pin fbjni to the React Native-compatible version';
const FORCE_RULE = "resolutionStrategy.force 'com.facebook.fbjni:fbjni:0.7.0'";

/** Keep react-native-anydoc's dynamic fbjni dependency aligned with RN/Hermes. */
module.exports = function withFbjniVersion(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('withFbjniVersion requires the Android Groovy build.gradle');
    }

    const contents = config.modResults.contents;
    if (contents.includes(FORCE_RULE)) return config;

    config.modResults.contents = `${contents.trimEnd()}\n\n${MARKER}\nallprojects {\n  configurations.configureEach {\n    ${FORCE_RULE}\n  }\n}\n`;
    return config;
  });
};
