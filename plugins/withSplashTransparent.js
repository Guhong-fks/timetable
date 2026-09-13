// Expo config plugin: 把 Android 系统启动屏图标设为透明。
//
// 系统启动屏阶段只留白（纯白背景），完整立绘由 RN 层 RnSplash 全屏接管。
// expo-splash-screen 插件把 windowSplashScreenAnimatedIcon 指向它生成的
// splashscreen_logo（小图，居中显示）。这里用 withAndroidStyles 在框架统一
// 写盘前修改 styles 对象，把该 item 改成透明，避免直接写文件被覆盖。
const { withAndroidStyles } = require('@expo/config-plugins');

const ICON_KEYS = ['windowSplashScreenAnimatedIcon', 'android:windowSplashScreenAnimatedIcon'];

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withSplashTransparent(config) {
  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults?.resources?.style;
    if (!Array.isArray(styles)) return cfg;
    for (const style of styles) {
      if (style?.$?.name !== 'Theme.App.SplashScreen') continue;
      const items = Array.isArray(style.item) ? style.item : (style.item ? [style.item] : []);
      for (const item of items) {
        if (ICON_KEYS.includes(item?.$?.name)) {
          item._ = '@android:color/transparent';
        }
      }
      break;
    }
    return cfg;
  });
};
