// Expo config plugin: 把 Android 12+ 系统启动屏的图标设为透明。
//
// 设计：系统启动屏阶段只留白（纯白背景），完整立绘由 RN 层的 RnSplash
// 全屏接管，避免系统强制的中心小图标（adaptive icon 尺寸固定、不可全屏）
// 在冷启动较慢的手机上停留。expo-splash-screen 插件按 app.json 生成的
// windowSplashScreenAnimatedIcon 默认指向 splash-icon（小图），本插件在
// prebuild 阶段把它改回 @android:color/transparent，保证每次 build 生效。
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** @type {import('@expo/config-plugins').ConfigPlugin} */
module.exports = function withSplashTransparent(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const stylesPath = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/res/values/styles.xml',
      );
      if (!fs.existsSync(stylesPath)) return cfg;
      let xml = fs.readFileSync(stylesPath, 'utf8');
      const re = /<item name="windowSplashScreenAnimatedIcon">[^<]*<\/item>/;
      const replacement = '<item name="windowSplashScreenAnimatedIcon">@android:color/transparent</item>';
      if (re.test(xml)) {
        xml = xml.replace(re, replacement);
      } else {
        // 插件没生成该 item 时，插入到 SplashScreen 样式块内。
        xml = xml.replace(
          /(<style name="Theme\.App\.SplashScreen"[^>]*>)/,
          `$1\n    ${replacement}`,
        );
      }
      fs.writeFileSync(stylesPath, xml);
      return cfg;
    },
  ]);
};
