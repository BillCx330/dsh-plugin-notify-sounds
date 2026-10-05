# dsh-plugin-notify-sounds

DSH 提示音插件：当智能体**需要你决策**（发起审批或提问）或**任务完成**（会话由运行转为空闲）时播放提示音。设置面板新增「提示音」栏目，可调整音量、音效与触发条件，界面与 DSH 原生设置风格一致。

English summary: notification sounds for DeepSeek Harness — a soft synthesized chime when the agent needs your decision or finishes a task, configured from a dedicated Settings section.

## 功能

- **需要决策时**：智能体发起审批（approval）或结构化提问（`ask_user_question`）时播放。触发源是 `uiSession.sessionStatus` 的 `pendingInteraction`——与侧栏状态点同源的事实，不侵入事件瀑布。
- **任务完成时**：任一会话从 running 转为 idle 时播放（含当前会话；可用「仅在页面不可见时提示」收窄）。
- **设置栏目**：设置 → 提示音（位于「通用设置」与「模型」之间）：
  - 启用提示音（总开关）
  - 音量（0–100，拖动松手后保存）
  - 需要决策时 / 任务完成时的音效选择（分段控件 + 试听，选中即试听）
  - 仅在页面不可见时提示（浏览器标签页后台时才响）
- **音效**：六种 Web Audio 合成音（双音铃 / 风铃 / 单音叮 / 水滴 / 脉冲 / 上行琶音）+ 无声。无音频文件、无网络请求。
- **持久化**：偏好通过 `configForms` 写入 Host 的 `notify-sounds` 配置命名空间（volatile 字段，即时生效，落在 profile 的 `cordis.patch.yml`）。

## 安装

以依赖形式加入你的 DSH profile，再登记到 bundle 列表（与官方插件一致的装载方式）：

```jsonc
// <profile>/package.json
"dependencies": {
  "dsh-plugin-notify-sounds": "github:BillCx330/dsh-plugin-notify-sounds"
}
```

```jsonc
// profile 的 bundle 列表（dsh.profile.bundles）追加：
"dsh-plugin-notify-sounds"
```

也可以克隆到本地后用 `file:` 依赖指向克隆目录——两种方式等价，插件是纯 ESM、无构建步骤。

### 发布说明

`package.json` 已按可发布形态声明：无 `private` 字段，`files` 只带运行时产物（`lib/`、`cordis.patch.yml`、README），`@deepseek-ai/schemastery` 声明为 peerDependency（由 DSH 运行时提供，与 dshmarket 的惯例一致，不引入副本），`repository`/`bugs`/`homepage` 已指向 GitHub 仓库。日后若发 npm，直接 `npm publish` 即可。

## 结构

```
dsh-plugin-notify-sounds/
├── package.json        # 清单：dsh.bundle.patch + dsh.client（inject 依赖与 platform）
├── cordis.patch.yml    # Loader 行：id: notify-sounds
├── LICENSE             # MIT
├── README.md           # 英文说明（链接到本文）
├── lib/
│   ├── index.js        # Host 半：volatile Config 模式（设置命名空间）+ 页面策略
│   └── client.js       # Client 半：音效引擎、sessionStatus 监听、设置分区 UI
└── test/
    └── smoke.mjs       # 冒烟测试：装配、触发、冷却、静音、写入
```

## 设计说明

- **触发不碰瀑布**：`approval/request` / `user-questions/request` 是 waterfall 事件，UI 应答后不调用 `next()`，晚注册的监听器收不到。本插件改读 `uiSession.sessionStatus`（DSH 自己聚合的 pending/running 事实），纯观察、零侵入。
- **导航图标**：设置外壳的 `navIcon()` 按 id 硬编码图标，未知 id（包括「通用设置」自己）都回落到同一个齿轮。平台没有第三方分区图标的注册点，因此本插件在面板挂载后把自己的导航格齿轮换成同一图标族的闹钟（`IconAlarmClockOutlineMedium` 的路径，1.3px 中等描边）：body 级 childList 观察器盯面板挂载，面板级观察器在 React 重建导航格后补换；React 不会重渲染未变化单元格的子节点，所以换过的图标在切换分区、切换语言时都保持。
- **音量滑杆不卡顿**：输入是非受控的。受控 `value` 会让每次拖动都经 React 状态往返，提交滞后于原生滑块位置时拇指会回弹。这里拖动只写一个 CSS 自定义属性（`--dsh-notify-sounds-fill`，样式表渐变读取它）和百分比文本，React 只在已接受值变化时重渲染一次；松手才提交，且一次手势只提交一次（pointer-up 后紧随的 blur 不会重复写）。
- **冷却**：同类触发 2 秒内不重复响，避免多会话同时完成时的嘈杂。
- **自动播放策略**：AudioContext 懒创建、播放时尝试 resume；页面尚无用户手势时静默跳过（浏览器策略，非错误）。插件卸载/热替换时关闭 AudioContext，不遗留音频线程。
- **健壮性**：音量值经 `Number.isFinite` 防护——手改 YAML 写入 `.nan`/`.inf` 时回落默认音量，而不是把非有限值送进 Web Audio（会抛错）。写入被拒时滑杆回弹到已接受值并显示错误行；开关在写入进行中禁用（与官方行一致，防双击竞写）。
- **主题**：全部使用 `--dsw-alias-*` / `--dsw-radius-*` 令牌；分区排版复刻「模型」分区（`gap:12px` 列布局、16px/500 标题、tertiary 14px 简介、行容器 `margin:12px 0 0`），行几何复刻「通用设置」行（`border-l2` 分隔线、14px 标题、12px 次要说明）。

## 已知边界

- **手改配置**：偏好落在 profile 的 `cordis.patch.yml`。手改时值必须匹配 schema（音量 0–100 整数、音效为七个预设 id 之一）；写错值会让 Host 条目校验失败、插件不加载，需改回正确值后重启。设置界面本身只会写入合法值。
- **多窗口**：每个 DSH 窗口各自独立触发；两个窗口同开时同一事件可能各响一次（开启「仅在页面不可见时提示」后可见窗口静默，实际只响一次）。
- **图标与面板结构**：导航图标替换依赖当前设置面板的 DOM 结构（`[data-shortcut-modal="settings"]` 与 `[svg, span]` 导航格）。未来 DSH 版本若改变结构，图标会静默回落为官方齿轮——功能不受影响，仅外观。

## 测试

```powershell
node test/smoke.mjs
```
