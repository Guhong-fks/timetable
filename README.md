# 课程表应用

当前版本面向 Web，支持导入固定模板的 `.docx` 课表，并按周次查看课程。

## 当前格式

- 第一列为节次，后七列依次为周一至周日。
- 课程单元格需要包含课程代码、周次和节次；同一单元格中的多门课程会自动拆分。
- Word 课表支持合并单元格（`rowspan`），导入后会保留课程所在星期和节次。
- 课程数据保存在浏览器 `localStorage` 中。

## 开发

```bash
npm install
npm run web
```

打开 `http://localhost:8081`，从“导入课表”选择文件。

## 手机运行

手机端已经支持通过 Expo Document Picker 选择 `.docx` 文件，数据和设置会保存在手机本地。

Windows PowerShell 如果提示禁止运行 `npm.ps1` 或 `npx.ps1`，请使用 `.cmd` 入口：

```powershell
npx.cmd expo start
```

手机安装 Expo Go 后，确保手机和电脑连接同一个 Wi-Fi，扫描终端中的二维码即可运行。

需要生成 Android 安装包时：

```powershell
npm.cmd install -g eas-cli
eas login
eas build:configure
eas build --platform android --profile preview
```

`preview` 用于生成测试 APK；发布正式版本时使用 `--profile production`。iOS 打包需要 Apple Developer 账号。

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).
# 课程表

一个基于 Expo、React Native 和 TypeScript 的课程表应用，支持 Web、Android 和 iOS。

## 功能

- 导入固定格式的 `.docx` 课表
- 支持 Word 合并单元格和同一单元格中的多门课程
- 按 18 周查看课程，并自动计算当前周次
- 显示周一至周日、具体日期、节次时间、地点和教师信息
- 可调整节次开始时间和课程时长
- Web 使用 `localStorage`，移动端使用 `AsyncStorage` 保存课表和设置
- 支持浅色、深色和跟随系统主题

## 课表文件格式

课表需要使用固定模板结构：

- 第一列是节次，后七列依次是周一至周日
- 课程内容需要包含课程代码、周次和节次
- Word 文件支持 `rowspan` 合并单元格

## 环境要求

- Node.js 20 或更高版本
- npm
- Android 开发需要 Android Studio 或 Android 真机

## 安装与运行

```bash
npm install
npm run web
```

Web 默认地址为 `http://localhost:8081`。

启动 Expo 开发服务器：

```bash
npm start
```

Windows PowerShell 如果禁止运行 `npm.ps1` 或 `npx.ps1`，使用 `.cmd` 入口：

```powershell
npm.cmd install
npx.cmd expo start -c
```

使用手机运行时，安装 [Expo Go](https://expo.dev/go)，并让手机和电脑连接同一个 Wi-Fi，然后扫描终端中的二维码。

## 检查代码

```bash
npm run lint
npx tsc --noEmit
npx expo-doctor
```

## 打包 Android

安装并登录 EAS：

```powershell
npm.cmd install -g eas-cli
eas login
eas build:configure
```

生成可直接安装的测试 APK：

```powershell
eas build --platform android --profile preview
```

生成用于发布到 Google Play 的版本：

```powershell
eas build --platform android --profile production
```

构建完成后，EAS 会提供下载地址。`preview` 配置用于内部测试，`production` 配置生成发布版本。

## 项目结构

```text
src/
├─ app/                 Expo Router 页面和 Tab 导航
├─ components/          主题化 UI 组件
├─ constants/           主题和布局常量
├─ hooks/               React Hooks
├─ lib/                 本地存储和文件解析
├─ state/               课表和主题状态
└─ types/               课表数据类型和转换函数
assets/                 应用图标和启动图
app.json                Expo 应用配置
eas.json                EAS 构建配置
```

## 安全说明

课表文件只在本地解析，不会主动上传到服务器。请不要导入来源不明的文件。仅支持 `.docx` 格式（已移除 `.xlsx` 以规避 `xlsx` 库已知的原型污染漏洞），建议只导入可信且规模合理的课表文件。

## 许可证

本项目使用仓库中的 [LICENSE](LICENSE) 文件所声明的许可证。
