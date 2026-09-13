# 课程表

一个基于 **Expo + React Native + TypeScript** 的课程表 App，主打 **Android** 移动端，支持从 `.docx` / `.doc` / `.xlsx` 及 `.ics`（日历导出）中解析课程，并按周次查看。

## 主要功能

### 📥 课表导入

- 从学校教务系统导出的课表（`.docx` / `.doc` / `.xlsx`）一键导入。
- **导入预览**：解析完成后先列出全部课程供确认，可直接修正课名/地点/教师、取消勾选误识别项，确认后才写入课表。
- **Position-first 识别器**：先定位表格结构再逐格读取，兼容正方、青果等不同教务系统导出格式。
- 同一单元格内的多门课程（换行 / 顿号分隔）自动拆分到对应的"星期 × 节次"。
- 完整支持 Word 的 `rowspan` / `colspan` 合并单元格，跨页断表自动拼接。
- **.ics 日历导入**：支持从 WakeUp 超级课程表等课程 App"导出到日历"生成的 `.ics` 文件。纯 JS 解析（无原生依赖，Expo Go 可用），自动处理重复规则（RRULE / COUNT / UNTIL）与单周多事件合并，周次按学期开始日期精确换算。
- **解析报告**：导入后自动检测异常（缺失字段、格式问题），底部横幅提示，点击可展开详情；解析失败可一键**导出解析诊断**（含设备 IR 现场），便于反馈定位。
- Expo Go 环境自动检测原生模块可用性，不可用时提前提示使用 Development Build。

### ⏰ 课程提醒（本地通知，默认课前 15 分钟）

- **开启方式**：设置页 → 提醒开关（需授予通知权限）；可自定义提前分钟数（1–180，默认 15）。
- **通知内容**：
  - 标题：课程名称
  - 正文：上课时间段（如 `08:00-09:30`）、上课地点、教师
- **点击跳转**：点击通知直接打开 App 并跳转到对应周次的课程详情卡片（自动切周、弹出详情）。
- **自动调度**：导入课表、修改学期开始日期、编辑/删除课程后自动重算（按课程增量重排，非全量清空重来）；通知仅针对当前学期已开启周次，过期自动清理。
- **节次时间联动**：提醒时间读取设置页配置的节次时间（`period-times.v2` / `period-durations.v1`）；未配置时回退默认规则（08:00 起 45 分钟/节），保证"课前 15 分钟"始终按真实上课时间触发。
- **持久化**：设置状态存入 `AsyncStorage`，重启后自动恢复调度。

### 📅 周次课表视图

- **自适应列宽**：宽屏保留 52px 列宽（"大学英语"等 4 字课名单行显示）；窄屏自动压缩列宽，让"时间列 + 周一~周日"**整周始终完整可见**——周日课程无需横向滚动即可直接查看。
- **节次数量自适应**：网格行数 = 导入课表最后一节课的节次（如一天实际只有 12 节则显示 12 行），不固定为 13 节。
- **紧凑网格布局**：7 天列 + 时间列，课程卡片按实际节次绝对定位，支持非标准跨度（如"5-7 节"）。
- **双向滑动切换周次**：一个手势同时驱动 X/Y 轴——纵向滚动课表（带惯性，`withDecay`），左右边缘拉动邻居周面板，松手按距离（30% 面板宽）或速度（550px/s）阈值决定是否切换。
- 邻居周面板**预挂载**（左右两侧同时就绪），拖动 / 切换 / 回弹动画流畅无卡顿、无中途渲染。
- **周次导航**：顶栏输入框直接跳转（支持跨多周），左右滑动切换相邻周；自动跳转到当前周（启动时、导入后、回到前台时）。头部"N 门课程 · 第 X 周"与网格同步翻转，不滞后于切换动画。
- **课程卡片编辑**：点击卡片查看详情，可编辑课名/地点/教师/周次/节次/颜色/备注；点击空格可直接添加课程；删除支持"本周 / 每周 / 整学期"三种范围确认。
- 日期显示：表头显示每天对应的实际日期，"今天"高亮为"今天"文字；左上角显示当前月份。

### ⏱️ 节次时间配置

- 支持 1~13 节。
- 点击左侧时间列的任意节次，弹窗编辑开始时间和课程时长（分钟），配置本地持久化。
- 默认每节 45 分钟、间隔 5 分钟，从 08:00 开始自动计算。

### 🎨 课程卡片

- **8 色调色板**：根据课程名称哈希自动分配颜色，同一课程跨天共享色相，渲染稳定不闪烁；也可在编辑弹窗中手动指定颜色。
- 卡片显示课程名 + 地点（底部锚定，长地址自动向上溢出）。
- 点击卡片弹出详情：上课时间（节次范围 + 具体时间段）、地点、教师、周次（全周 / 单双周 / 指定周范围）、备注；详情内可直接编辑课程。
- 深色模式使用统一卡片配色（单一材质色 + 同色系描边），保证对比度与整体观感。

### 📱 桌面小部件（Android App Widget）

- 原生 Kotlin 实现的桌面小组件，展示当前周每日课程；源码唯一真源在 `widgets/` 目录，由 `@bittingz/expo-widgets` 配置插件在 prebuild 时复制并替换包名生成到 `android/`（CNG 模式，`android/` 不入库）。
- 课表变化（导入/编辑/删除）后自动同步小组件数据，支持点击课程卡片跳转 App。

### 🌗 主题与设置

- 浅色 / 深色 / 跟随系统三种模式，配置持久化。
- **自定义背景**：从相册选择课表背景图与启动页图，透明度可调，本地持久化。
- 设置页：当前文件名、课程总数、一键清空数据；「关于」区提供**检查更新**（GitHub Release 对比 + APK 下载）。

### 🛡️ 安全与本地存储

- 课表和设置**仅保存在设备本地**，不上传任何服务器。
- 课表数据不离开设备：写入 `AsyncStorage` 的明文仅存于应用私有目录（Android 沙箱内），无网络上传路径。
- 已关闭 Android 自动备份（`allowBackup=false`）：系统云备份 / ADB 备份不会带走课表数据，与"数据不出设备"口径一致。
- 顶层 `ErrorBoundary` 兜底解析/渲染异常。
- v1 → v4 存储格式自动迁移，旧数据无感升级。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Expo SDK 57、React Native 0.86.3、React 19.2.3 |
| 语言 | TypeScript 6.0.3（strict 模式） |
| 路由 | Expo Router（基于文件系统的路由 + typedRoutes） |
| 状态 | React Hooks + AsyncStorage（v1→v4 存储迁移） |
| 手势 | `react-native-gesture-handler` 2.32 + `react-native-reanimated` 4.5.1 + `react-native-worklets` 0.10.1 |
| 文件解析 | `react-native-anydoc`（Rust，.docx/.doc/.xlsx → DocumentIR）+ position-first 识别器；`.ics` 日历文件纯 JS 解析（Expo Go 可用） |
| 构建 | EAS Build（development / preview / production 三套 Profile） |
| 测试 | Jest 29 + jest-expo（支持组件测试），16 个测试文件 / 256 用例，含 golden fixture 对比 |



## 课表文件格式

使用学校教务系统导出的课表模板：

- 位置优先识别：表格中的星期 / 节次由**网格位置**推导，单元格文本（周次、教师、地点）只做补充。
- 课程单元格通常包含：课程代码、课程名称、周次范围、地点、教师（缺失字段自动降级并提示）。
- 同一单元格内的多门课程会被自动拆分到对应节次；跨页断表自动拼接。
- 支持 Word 的合并单元格（`rowspan` / `colspan`）。
- 支持 `.docx` / `.doc` / `.xlsx`，单文件不超过 5 MB；`.xlsx` 与 Word 共用同一 anydoc → 识别器管线（建议使用「星期 × 节次」矩阵式表格布局，扁平列表可能无法识别）。

另外支持从课程表 App（WakeUp 超级课程表等）"导出到日历"生成的 `.ics` 文件：纯 JS 解析（无原生依赖），按学期开始日期换算周次，自动展开重复规则（RRULE / UNTIL / COUNT）并将同一课程的多条单周事件合并。

## 环境要求

- **Node.js 20+**、**npm**（或 `pnpm` / `yarn`）。
- **Android 真机或模拟器**：Android 7.0 (API 24) 及以上。
- 可选：EAS 账号（用于云端构建 APK）。

## 开发

```bash
# 安装依赖
npm install

# 启动 Expo 开发服务器（同一 Wi-Fi 下手机用 Expo Go 扫码）
npm start

# 启动 Web 版本（仅供调试 UI）
npm run web
```

> ⚠️ **Windows PowerShell** 若提示禁止运行 `npm.ps1` / `npx.ps1`，请使用 `.cmd` 入口：
> ```powershell
> npm.cmd install
> npx.cmd expo start -c
> ```

### 代码检查

```bash
npm run lint          # ESLint（expo-config）
npx tsc --noEmit      # TypeScript 类型检查
npx expo-doctor       # Expo 配置健康检查
npm test              # Jest 单元测试
```




## 项目结构

```
src/
├─ app/                  Expo Router 页面与 Tab 导航
│  └─ (tabs)/            Tab 页：课表、导入、设置
├─ components/           主题化 UI 组件（ErrorBoundary、themed-text/view、CourseEditModal、ImportPreview、PeriodTimeModal、LeadMinutesModal、RnSplash）
├─ constants/            主题色、布局常量、存储 key（theme、storage-keys）
├─ hooks/                React Hooks（useTheme、useTimetablePanGesture）
├─ lib/
│  ├─ engine/            解析引擎：tableGrid、cellReader、recognizer、parseDiagnostics
│  ├─ importers/         导入管线：timetable-importer、ics-parser、parsers
│  ├─ reporting/         导入报告生成（CourseWarning）
│  ├─ course-palette.ts  课程卡片调色板（网格与编辑弹窗共享）
│  ├─ period-format.ts   节次默认值 / 时间与周次格式化工具
│  ├─ notifications.ts   课程提醒调度（增量重排 + 默认节次回退 + 用户配置节次时间）
│  ├─ update-check.ts      检查更新（GitHub Release 对比 + APK 直链）
│  ├─ test-notification.ts 测试通知发送
│  ├─ widget-data.ts     桌面小组件数据同步
│  ├─ security.ts        导入文件校验（白名单 / 大小 / URI 协议）
│  └─ storage.ts         AsyncStorage 封装（超时保护）
├─ state/
│  ├─ timetable/         课表 Context + 存储 + v1→v4 迁移（index/types/storage/migrate）
│  ├─ background-context.tsx  自定义课表背景 / 启动页（相册选择 + 本地持久化）
│  └─ theme-context.tsx  浅色 / 深色 / 跟随系统
├─ types/
│  └─ timetable.ts       课表数据类型与工具函数
├─ __tests__/            Jest 单元测试（16 个文件：解析器、迁移、通知、格式化、组件）
└─ __mocks__/            模块 mock（react-native-anydoc、nitro-modules）
app.json                 Expo 应用配置
eas.json                 EAS 构建 Profile
assets/                  图标、启动图
```



## 安全说明

本应用对不可信输入做了多层防护：

- **文件类型校验**：仅接受 `.docx` / `.doc` / `.xlsx` / `.ics`，单文件上限 5 MB；文件名 / MIME / URI 协议白名单校验。
- **文本清洗**：解析出的文本统一过滤控制字符、双向字符与零宽字符，并截断超长字段。
- **解析隔离**：Rust 引擎在独立线程解析，恶意文档的 panic 会被引擎捕获为 `fallback` 状态而不是崩溃。
- **本地私有存储**：课表 JSON 写入 `AsyncStorage`（应用沙箱目录），设备外不可读取；无任何网络上报。
- **错误隔离**：顶层 `ErrorBoundary` 兜底解析/渲染异常，避免崩溃导致数据丢失。

⚠️ 请仅导入来源可信的课表文件。课表与设置均**仅保存在设备本地**，不会上传到任何服务器。

## 路线图

- [x] 导入预览与人工修正（确认后才落库）
- [x] 解析诊断导出（识别失败时分享 IR 现场供反馈）
- [x] 课程提醒（上课前 15 分钟本地通知）
- [x] 桌面小部件（Android App Widget）

## 许可证

本项目使用 MIT 许可证，详见 [LICENSE](./LICENSE)。
