// Expo config plugin: 关闭 Android 自动备份（allowBackup=false）。
//
// 背景：课表数据（含课程/地点/教师）保存在设备本地 AsyncStorage，README 的
// 安全口径是"课表数据不离开设备"。Android 默认 allowBackup=true 时，云备份 /
// ADB 备份会把应用私有数据（含 AsyncStorage 明文）带离设备，与声明不符。
// 通过 config plugin 在 prebuild 阶段把 allowBackup 写为 false，保证生成物
// 与配置单一来源一致（android/ 是 gitignored 生成物，不应手改）。
const { withAndroidManifest } = require('@expo/config-plugins');

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withNoBackup(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:allowBackup'] = 'false';
    }
    return config;
  });
};
