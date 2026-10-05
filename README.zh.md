# dsh-plugin-notify-sounds

DSH 提示音插件：当智能体**需要你决策**（发起审批或提问）或**任务完成**（会话由运行转为空闲）时播放提示音。设置面板新增「提示音」栏目，可调整音量、音效与触发条件，界面与 DSH 原生设置风格一致。

English summary: notification sounds for DeepSeek Harness — a soft synthesized chime when the agent needs your decision or finishes a task, configured from a dedicated Settings section.

## 功能

- **需要决策时**：智能体发起审批（approval）、计划确认（plan-review）或提问（question）时播放。触发源是 `uiSession.sessionStatus` 的 `pendingInteraction`——与侧栏状态点同源的事实，不侵入事件瀑布。**审批与提问可分别配置音效**（交互对象自带 `kind` 判别字段）。
- **任务完成时**：任一会话从 running 转为 idle 时播放（含当前会话；可用「仅在页面不可见时提示」收窄）。
- **自定义铃声**：上传本地音频（mp3/wav/ogg 等，≤512KB），解码校验 + 峰值自动归一化后作为「自定义」档出现在三个音效选择器中；以 base64 存于插件配置，无需额外文件服务。
- **系统通知**：页面处于后台时，除提示音外弹出系统通知（正文取审批理由/提问原文），点击聚焦窗口；开启开关时才请求浏览器权限，权限状态实时显示在行内。桌面端主窗口对通知权限放行；不支持的环境自动降级为不可用提示。
- **标题栏提醒**：页面后台且有未处理决策时，在窗口标题前加铃铛标记，回到页面自动清除（与 DSH 自身的标题管理叠加不冲突）。
- **未处理决策重复提醒**：决策挂起超过设定间隔（1/5/15/30 分钟）没人处理时重复提示，直到处理或关闭。
- **静音时段**：每天固定时间段（如 22:00–08:00，支持跨午夜）内不发出任何声音与通知。
- **音效**：九种 Web Audio 合成音（双音铃 / 风铃 / 单音叮 / 水滴 / 脉冲 / 上行琶音 / 金币 / 达成 / 敲门）+ 自定义 + 无声。无音频文件、无网络请求。
- **设置栏目**：设置 → 提示音（位于「通用设置」与「模型」之间），每项功能均有独立开关，界面与 DSH 原生设置风格一致。
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
- **冷却**：同类触发（审批/提问/完成各自独立）2 秒内不重复响，避免多会话同时完成时的嘈杂。
- **自动播放策略**：AudioContext 懒创建、播放时尝试 resume；页面尚无用户手势时静默跳过（浏览器策略，非错误）。插件卸载/热替换时关闭 AudioContext，不遗留音频线程。
- **自定义铃声管线**：上传时先做尺寸检查（≤512KB）与 `decodeAudioData` 试解码，坏文件直接拒绝；播放时按 base64 缓存解码结果，首次播放异步、后续即时；峰值归一化把最响采样对齐到满幅（增益上限 4×，避免放大底噪）。选择器指向「自定义」但数据已被移除时，回落到该触发的默认音效而不是静音。
- **系统通知的降级链**：`Notification` 不存在 → 行内提示「不支持」；权限被拒 → 行内提示引导去浏览器或系统设置；一切异常静默。通知本身 `silent`（不叠加系统音），按触发类型打 tag 折叠重复。
- **标题闪烁的共存**：只做前缀加/删，不覆写标题本体，与 DSH 自身的标题更新互不干扰；回到页面（visibilitychange）即清除。
- **重复提醒的节拍**：15 秒粒度检查一次未处理决策集合（来自同一份 sessionStatus 快照），按「首次出现时间 + 间隔」推进，交互对象身份变化（新问题替换旧问题）即重置计时；复用与首响完全相同的 notify 管线（含静音时段/仅后台/冷却约束）。
- **健壮性**：音量值经 `Number.isFinite` 防护——手改 YAML 写入 `.nan`/`.inf` 时回落默认音量，而不是把非有限值送进 Web Audio（会抛错）。静音时段时间串解析失败视为未配置。写入被拒时滑杆回弹到已接受值并显示错误行；开关在写入进行中禁用（与官方行一致，防双击竞写）。
- **主题**：全部使用 `--dsw-alias-*` / `--dsw-radius-*` 令牌；分区排版复刻「模型」分区（`gap:12px` 列布局、16px/500 标题、tertiary 14px 简介、行容器 `margin:12px 0 0`），行几何复刻「通用设置」行（`border-l2` 分隔线、14px 标题、12px 次要说明、文字左/控件右）。音效选择用官方 `Menu` 下拉而非分段控件——十档预设的分段控件会超出面板宽度、把设置面板撑出横向滚动；下拉自带勾选态、方向键遍历与点外/Escape 关闭。行内文字块 `flex:1 + min-width` 收缩、控件组可换行，任何行都不会横向溢出。

## 已知边界

- **手改配置**：偏好落在 profile 的 `cordis.patch.yml`。手改时值必须匹配 schema（音量 0–100 整数、音效为预设 id 之一、静音时段为 `HH:MM` 24 小时制）；写错值会让 Host 条目校验失败、插件不加载，需改回正确值后重启。设置界面本身只会写入合法值。
- **多窗口**：每个 DSH 窗口各自独立触发；两个窗口同开时同一事件可能各响一次（开启「仅在页面不可见时提示」后可见窗口静默，实际只响一次）。
- **图标与面板结构**：导航图标替换依赖当前设置面板的 DOM 结构（`[data-shortcut-modal="settings"]` 与 `[svg, span]` 导航格）。未来 DSH 版本若改变结构，图标会静默回落为官方齿轮——功能不受影响，仅外观。
- **系统通知权限**：桌面端主窗口放行通知权限；若在受限环境（如某些浏览器策略）下被拒，开关行会显示状态并引导手动允许，其余功能不受影响。
- **升级行为变化**：v1.1.0 起提问与审批分轨——已安装 v1.0.0 的用户升级后，提问默认从「双音铃」变为「风铃」（审批不变）。如需保持一致，在设置里把提问音效改回即可。

## 更新记录

- **v1.1.2**（2026-10-05）：修复下拉列表空白——官方 `Menu` 条目文字字段是 `label`（`text` 是分组标题专用），v1.1.1 传错字段导致每行渲染为空文字；冒烟测试新增「每个条目 label 非空」断言防回归。
- **v1.1.1**（2026-10-05）：排版与文案修复——音效选择器改用官方 `Menu` 下拉，消除设置面板横向滚动；全部行改为「文字左/控件右」的官方行几何；重写全部描述（去掉浏览器专属措辞与表情符号，「窗口标题提醒」等表述更直白）；选择器指向已移除的自定义音效时界面同步回落。
- **v1.1.0**（2026-10-05）：自定义铃声（上传/校验/归一化/缓存）；系统通知（权限管理 + 降级链）；审批与提问分轨音效；未处理决策重复提醒；静音时段；新增三种预设音效（金币/达成/敲门）；每项功能独立开关。
- **v1.0.0**（2026-10-04）：首个版本——决策/完成双触发、音量滑杆、六种合成音效、仅后台提示、DSH 原生风格设置分区。

## 测试

```powershell
node test/smoke.mjs
```
