# macOS 桌面端的「窗口标题提醒」

**结论（方案 1，已实现）**：macOS Desktop 上不再禁用这个开关。标题标记照旧写进
`document.title`，只是它不画在标题栏上——显示面是 **「窗口」菜单、Mission Control /
App Exposé 的窗口标签、Dock 图标右键的窗口列表**。设置行改为如实说明这三处，而不是
声称「无处显示」。

本文记录核对过程，供上游复核与将来改动参考。核对对象是 **DSH Desktop 0.2.2-rc.5**
（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`）。

## 1. 为什么以前是禁用的

`lib/client.js` 旧实现：

```js
const titleFlashUnavailable = () => isMac() && isDesktopShell();
```

注释的推理是「macOS Desktop 隐藏了标题栏（`titleBarStyle`），Dock 也不显示窗口标题，
所以标记无处显示」。前半句对，后半句是错的：**标记没有画在标题栏，但它是窗口的真实
标题**，macOS 有一整套按窗口标题显示的面板。

## 2. 事实核对：页面标题确实走到窗口标题

| 事实 | 证据（rc.5 安装包内） |
|---|---|
| 主窗口隐藏标题栏文字 | `lib/main.js` 主 `BrowserWindow` 的 darwin 分支：`titleBarStyle: "hiddenInset"`、`trafficLightPosition`、`vibrancy: "sidebar"`，且**没有** `title:` 选项 |
| 主窗口不拦截页面标题 | `main.js` 全文只有一处 `page-title-updated` 监听，位于 policy-login 窗口（`event.preventDefault()`）；主窗口没有该监听，故走 Electron 默认行为：页面的 `<title>` 成为窗口标题 |
| 页面会写标题 | `dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/src/client/DocumentTitle.tsx:24-27`：`document.title = title === undefined ? productTitle : \`${title} — ${productTitle}\``，卸载时还原为 `productTitle` |
| macOS 有原生「窗口」菜单 | `main.js` 应用菜单 darwin 分支含 `{ role: "windowMenu" }`；系统按窗口标题列出窗口 |
| 「页面标题 → 窗口标题」这条传播本身已被依赖 | 插件自己的 Host 半在 Windows 上按窗口标题定位主窗口（`lib/index.js` 的 `DESKTOP_APP_TITLE` / 后缀匹配）；这条链能工作，说明页面标题确实到达 OS 层窗口标题 |

所以标记在 macOS 上**是可见的**，只是可见的位置不是标题栏，而是上面那几个按标题列出
窗口的系统面板。标题形如 `待处理 会话名 — DeepSeek Harness`。

### 运行时确认（0.2.2-rc.5，本机）

在运行的 DSH Desktop 上直接读 CoreGraphics 的窗口列表（`CGWindowListCopyWindowInfo`，
包含屏幕外窗口），该进程的窗口标题是：

```
{'owner': 'DeepSeek Harness', 'title': '升级前插件兼容性审核 — DeepSeek Harness'}
```

也就是 `会话标题 — DeepSeek Harness`——**页面 `document.title` 确实成了 macOS 原生窗口
标题**，与上面的代码链条一致。这正是「窗口」菜单、Mission Control / App Exposé 与 Dock
窗口列表读取的字段。

> 说明：「窗口」菜单逐项本身没法在这里枚举——`System Events`（`osascript`）被辅助功能
> 权限挡住，只返回 `-1728`。上面的窗口标题是这些面板标签的数据来源，因此可见性成立；
> 但「菜单里长什么样」仍建议人工看一眼（步骤见文末）。

## 3. 为什么没走更优通道（Dock 徽章 / 图标弹跳）

调研过三条可能更强的通道，结论都是**当前没有公共入口**：

- **预加载桥 `window.dshDesktop`**（`lib/preload-app.cjs` 的 `createProductApi()`）只提供
  `fileActions` / `browser` / `fileDrag` / `deviceInfo` / `keyboard` / `shortcuts` /
  `updates`，没有任何窗口注意力、徽章或标题控制。
- **外壳自己会做**：`lib/main.js` 的更新弹窗会用 `parent.flashFrame(true)`（win32）与
  `app.dock.bounce("informational")`（darwin）提醒用户，并在窗口获得焦点后清除。但这段
  逻辑只属于更新弹窗，没有 IPC 暴露给插件；`main.js` 里**没有** `setBadge` /
  `setOverlayIcon` 调用，因此 Dock 角标本身也不存在。
- **托盘**：`main.js` 的 `DesktopTray` 注释写明是 "Windows system tray"，macOS 上不注册，
  没有菜单栏常驻图标可用。
- **`@deepseek-ai/dsh-desktop-host`**：只有启动与 webServer 相关逻辑，不含 window /
  focus / attention API。
- 结构上也不通：插件 Host 半是 DSH CLI 的子进程，不是 Electron main 进程，拿不到
  `app.dock`；`lib/index.js` 现有的唤窗在 macOS 上只能 `open -b com.deepseek.dsh`，那是
  把窗口带到前台，不是「持续可见的提醒」。

所以方案 2（Dock 角标 / 弹跳）在 rc.5 上**无法实现**，等 DSH 暴露相应 IPC 才有意义。

## 4. 改动清单

- `lib/client.js`
  - `titleFlashUnavailable()` → `titleFlashHiddenTitleBar()`：只决定文案，不再决定可用性；
    注释写明核实过的传播链与三处显示面。
  - 该行的 `disabled` 不再包含平台判断，只保留「写入进行中」的忙等禁用。
  - `SwitchRow` 增加可选 `hint`（描述下方的一行小字），只在 macOS Desktop 传入。
  - 字典：`titleFlash.macUnsupported` → `titleFlash.macDescription` + `titleFlash.macHint`
    （zh / en 同步）。
- `README.md` / `README.zh.md`：功能表、已知边界、设计与实现三处补上 macOS 的显示位置。
- `test/smoke.mjs`：新增两条断言——macOS Desktop（开关可用、mac 文案、有 hint）与
  macOS 浏览器标签页（开关可用、普通文案、无 hint）。

## 5. 仍然存在的限制（应向上游说明）

- 「窗口」菜单需要先切到 DSH 才会展开；Mission Control / App Exposé 需要主动呼出。两者
  都**不如 Windows 任务栏一眼可见**，所以 macOS 上真正「一眼就能看到」的通道仍是系统
  通知（本插件已经提供，建议与标题标记一起开）。
- 标记语义不变：「已完成」是未读消息（离开期间发生的完成才标记），回到页面即清除；
  静音时段、总开关、`titleFlash` 自身开关都照旧生效。
- macOS 浏览器标签页不受影响：`isDesktopShell()` 为假，走原来的「标签页标题可见」路径。

## 6. 给上游的建议

1. 保留这个开关在 macOS 可用，文案说明显示位置（本分支的做法）。
2. 若 DSH 日后开放桌面注意力通道（Dock 角标 / `bounce` / 自定义标题 IPC），把这一行在
   macOS Desktop 上改走该通道，并保留标题标记作为兜底。
3. 不要在文档里再写「macOS 不支持」——更准确的说法是「macOS 不在标题栏显示，请到
   「窗口」菜单 / Mission Control / Dock 窗口列表查看」。

## 7. 人工验证步骤

1. 设置 → 提示音 → 打开「窗口标题提醒」（macOS 上应为**可用**，且描述下方有一行
   「macOS 不绘制标题栏文字……」的提示）。
2. 让 DSH 窗口失去焦点（切到别的 app）或最小化，然后触发一次需要决策的事件（例如让
   智能体发起审批）。
3. 展开「窗口」菜单（或呼出 Mission Control / 右键 Dock 图标看窗口列表）：标题应以
   「待处理 」开头；任务完成的场景以「已完成 」开头。
4. 回到 DSH 窗口后，标记应清除；再次切走不应重新出现（「已完成」是未读语义）。
