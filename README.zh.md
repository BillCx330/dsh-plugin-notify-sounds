# dsh-plugin-notify-sounds

[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/billcx330/dsh-plugin-notify-sounds)
[![DeepSeek Harness plugin](https://img.shields.io/badge/dsh-plugin-8b5cf6.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![npm version](https://img.shields.io/npm/v/dsh-plugin-notify-sounds.svg)](https://www.npmjs.com/package/dsh-plugin-notify-sounds)
[![npm downloads](https://img.shields.io/npm/dm/dsh-plugin-notify-sounds.svg)](https://www.npmjs.com/package/dsh-plugin-notify-sounds)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | 中文

**智能体在等你、或干完活时，轻轻响一声。**

人不在窗口前也不怕：最小化、被遮挡、或只是切到别的窗口，都会弹系统通知（**点击即回到窗口**），窗口标题亮出「待处理 / 已完成」（Windows 显示在任务栏，macOS 显示在「窗口」菜单 / Mission Control / Dock 窗口列表）；你回来看过一眼之后，它就闭嘴——不会像闹钟一样反复催你。

**安装**：DSH → 左侧栏「插件」→ 添加插件，粘贴下面这行（**带上版本号**，否则发布不满 24 小时的版本会被 pnpm 的 `minimumReleaseAge` 解析回上一版），点「安装」：

```
dsh-plugin-notify-sounds@1.9.7
```

---

## 🎨 与 DSH 界面风格统一

设置面板中的每一处视觉细节都取自 DSH 自身的设计体系：行几何、分隔线、字号与间距沿用官方设计令牌，音效选择器使用官方 `Menu` 组件，图标来自官方图标族，排布沿用「文字左 / 控件右」的原生行式。安装后不会在设置中出现风格割裂的第三方区块。

## ✨ 它能做什么

| 提醒什么 | 效果 |
|---|---|
| **需要你决策** | 智能体发起审批、计划确认、提问时提示音；审批与提问可分别设音效 |
| **任务完成** | 会话由运行转为空闲时提示音 |
| **人不在窗口前也能感知** | 最小化、被遮挡或只是没在用它时都弹系统通知（正文就是审批理由或提问原文，点击回到窗口）；窗口标题显示「待处理 / 已完成」（Windows 在任务栏；macOS 在「窗口」菜单、Mission Control 与 Dock 的窗口列表） |
| **没看到会再提醒** | 未处理决策按 1/5/15/30 分钟重复提醒 |
| **只提醒你关心的** | 子智能体（后台任务）默认完全静默，只提醒主对话，可开关 |
| **该安静时安静** | 静音时段（如 22:00–08:00，可跨午夜）、仅离开页面时提示（不可见或失焦）、总开关一键全静音 |
| **声音随你** | 九种内置音效（彼此响度已对齐）；**最多 3 个自己的音频**，可改名、指派给任意提醒（mp3 / wav / ogg / m4a，每个 ≤15 秒）；音量调节；每项独立开关 |
| **检测更新** | 设置里检查 npm 新版本，并按你的 DSH 版本给出最短的升级路径：**0.2.2 及以上在左侧栏「插件」点一下「更新」**即可就地升级；0.2.1 及更早给出卸载重装的步骤；web profile 给出命令行。若当前安装未被 lockfile 记录，会在行内提示 |

## 💡 为什么需要它

DSH 的状态提示只有视觉——状态点、侧栏标记。你一切到别的窗口，就既看不到也听不到，智能体却可能正卡在那里等你一句话。

这个插件把「在等你」和「干完了」变成声音。配合系统通知与标题标记，人走开也知道发生了什么；而你回来处理过之后它就安静——重复提醒也只针对你**从没看过**的决策。

## 🔔 声音

双音铃 · 风铃 · 单音叮 · 水滴 · 脉冲 · 上行琶音 · 金币 · 达成 · 敲门 —— 九种内置音效全部由 Web Audio 现场合成，不含任何音频文件、不发一次网络请求。

也可以换上你自己的音频（mp3 / wav / ogg / m4a，每个 ≤15 秒、3MB，自动校验并做响度归一化），或者干脆选「无声」只留通知。三种触发（审批 / 提问 / 完成）各选各的音效，设置里随时试听。

## ⚙️ 设置

设置 → **提示音**（位于「通用设置」与「模型」之间），每项功能都有独立开关，界面与 DSH 原生设置完全一致：

总开关与音量 · 三种触发各自的音效（含试听）· 子智能体提醒 · 系统通知 · 窗口标题提醒 · 重复提醒间隔 · 静音时段 · 仅离开页面提示 · 最多 3 个可改名的自定义音频 · 自动检查更新（升级在「插件」页完成）

改动即时生效，无需重启。

## 📦 安装

### 🖱️ 最简单：在 DSH 里点两下（推荐）

1. 打开 DSH → **左侧栏「插件」**，点**添加插件**；
2. 在输入框粘贴包名**和版本号**（本插件已发布在 [npm](https://www.npmjs.com/package/dsh-plugin-notify-sounds)）：

   ```
   dsh-plugin-notify-sounds@1.9.7
   ```

   版本号不要省：pnpm 的 `minimumReleaseAge` 策略会把刚发布不到 24 小时的版本挡在外面，只写包名会解析回上一个版本。想看最新版本号可到 [npm](https://www.npmjs.com/package/dsh-plugin-notify-sounds?activeTab=versions) 或 [Releases](https://github.com/BillCx330/dsh-plugin-notify-sounds/releases) 查。
   （填 GitHub 仓库地址 `https://github.com/BillCx330/dsh-plugin-notify-sounds` 或本地目录路径也可以，但那样不带版本锁定）
3. 点**安装**，装完**重启 DSH** 一次。

输入框上方的「安装源」是下载源，默认中国大陆镜像源，国内一般不用改。DSH 会提示「插件以你的权限运行」——本插件只读会话状态、在本地发声。对外的网络请求只有一处：升级检查时向 npm 查询版本（每天最多一次，可在设置里关掉）。点击系统通知时请求的是**本机 DSH** 唤窗，不向外部发送任何数据。

### ⬆️ 升级

**升级由包管理器安装**，这样 profile 的 lockfile 会跟着一起更新——DSH 插件无法自己持久地更新自己（管理器拒绝已声明的包，而它的「先移除再安装」会先卸载掉正要完成安装的代码）。所以插件只负责**检查**，并告诉你从哪里装：

- **0.2.2 及以上**：**左侧栏「插件」** → 本插件那一行会显示版本状态，直接点更新（不用再卸载重装）。
- **0.2.1 及更早**：**左侧栏「插件」** → 在「已安装插件」里卸载本插件 → **添加插件** → 粘贴 `dsh-plugin-notify-sounds@<版本>` → 安装 → 重启 DSH。（务必带版本号：pnpm 的 `minimumReleaseAge` 会让刚发布不到 24 小时的版本不参与自动解析，只写包名会装回上一个版本。）

卸载不会丢东西：偏好和自定义音频都存在 profile 里（`cordis.patch.yml` 与 `notify-sounds/sounds/`），重装后自动恢复——包括升级到 1.9.0 时由旧版内嵌音频自动迁移过来的那份。
- **`web` profile**：`dsh plugin --profile <你的 profile> add dsh-plugin-notify-sounds@<版本>`。

更新行还会提示「当前版本与 lockfile 记录不一致」——那是 1.8.0 之前的自更新留下的状态，按上面方式重装一次即可永久修好。

### 🛠️ 其他安装方式

**命令行** —— 对你实际使用的 profile 一条命令：

```sh
dsh plugin --profile <你的 profile> add github:BillCx330/dsh-plugin-notify-sounds
```

（Git 安装跟仓库默认分支走，不带版本锁定；要可复现的安装请用上面的 `包名@版本号`。）

**Release 压缩包** —— 从 [Releases](https://github.com/BillCx330/dsh-plugin-notify-sounds/releases) 下载 `.tgz`，用它**在磁盘上的路径**安装：

```sh
dsh plugin --profile <你的 profile> add ./dsh-plugin-notify-sounds-1.9.7.tgz
```

（`dsh plugin add` 把参数原样交给包管理器，所以要给本地文件路径，不能填下载地址。）

**本地目录** —— 开发或试用未发布的改动：

```sh
dsh plugin --profile <你的 profile> add ./dsh-plugin-notify-sounds
```

**手工编辑** —— 在 profile 的 `package.json` 的 `dependencies` 加 `"dsh-plugin-notify-sounds": "github:BillCx330/dsh-plugin-notify-sounds"`，在 `dsh.profile.bundles` 追加 `"dsh-plugin-notify-sounds"`，然后在 profile 目录跑一次包安装（如 `pnpm install`）把依赖装进 `node_modules`。

命令行方式会自动写入 `dsh.profile.bundles` 并装好依赖，无需手工编辑。包内直接带预构建产物、不声明任何生命周期脚本，安装过程不执行构建脚本。安装后**重启 DSH**（日常升级仅客户端改动时，可热更生效）。

## ⚠️ 已知边界

- **自定义音频存在哪**：音频按内容哈希存成 `profiles/<profile>/notify-sounds/sounds/<sha256>.<ext>`，配置里只留文件名。**备份或换机要拷整个 profile 目录**——只拷 `cordis.patch.yml` 不会带上音频。卸载插件后最多留下最后一个文件（几百 KB）。
- **手改配置**：偏好写在 profile 的 `cordis.patch.yml`，值必须符合 schema（音量 0–100、音效为预设之一、时间 `HH:MM`）；写错会让插件不加载，改回即可。设置界面只会写入合法值。
- **升级由包管理器安装，不再由插件自己完成**：1.8.0 移除了自安装器（原地写文件从不会更新 profile 的 lockfile，于是下一次插件安装会静默把旧版本装回来）。更新行仍会检查 npm、报告新版，然后按版本给最短路径：**0.2.2 及以上在左侧栏「插件」里点「更新」就地完成**；0.2.1 及更早需要卸载重装；web profile 用 `dsh plugin add`。
- **1.7.0 及更早版本**可以通过它们自带的自更新到达 1.8.0（1.8.0 保持同样的七个文件名），但这次到达不会被 pnpm 登记：按上面的方式用包管理器重装一次，此后所有升级都会留下。1.6.9 及更早无法安装「新增了文件」的版本——固定白名单会安全拒绝；同样的一次性重装即可解决。
- **多窗口**：提示音、系统通知和重复提醒由同一个 GUI 的所有页面选出一个「发声页」来发（1.7.0 起），所以同一个事件只响一次；窗口标题标记仍是每个窗口各自一份，因为它们各自有标题。发声页关闭或崩溃后几秒内由其他页面接管。
- **macOS 的标题标记显示在哪儿**：桌面端按系统风格隐藏了标题栏文字（`titleBarStyle: "hiddenInset"`），所以标记不会画在标题栏上。但它改的仍是窗口的真实标题：会出现在「窗口」菜单、Mission Control / App Exposé 的窗口标签，以及 Dock 图标右键的窗口列表里（形如「待处理 会话名 — DeepSeek Harness」）。开关照常可用，设置行里也写明了要去哪儿看；「已完成」仍是未读语义，回到页面就清除。
- **点击通知回到窗口**：Windows 完整实现并实测；macOS / Linux 走系统深链，未验证。
- **关闭到后台后点通知会慢一点**：这种情况走系统深链、由 Electron 自己把窗口 `show` 回来（否则画面会停在最后一帧），窗口出现比平时慢约 0.5–1.5 秒；停在欢迎页时深链可能不生效。
- **第三方封装的桌面客户端**（如 DSH NEXT）：唤窗依赖官方壳的 Win32 能力与 `dsh://` 协议注册，封装版没有这两样，点击通知不会回到窗口——那是宿主侧缺的，插件无法补。
- **唤窗按窗口标题定位主窗口**：刻意不读取其他进程信息（那会触发杀软主动防御）。若将来 DSH 改变标题格式，唤窗会静默失效——提示音与通知本身不受影响。
- **导航小图标**：0.2.2 起走官方 `settings.section.icon` 插槽；0.2.1 及更早靠替换设置面板里的图标节点，那一代再改版可能回落为官方齿轮（仅影响外观）。
- **通知权限**：桌面端放行；受限环境（某些浏览器策略）下被拒时，行内会引导手动允许，其余功能不受影响。
- **macOS 的系统通知**：桌面外壳对权限请求一律放行，所以设置里恒显示「已授权」；**实际是否弹横幅由 macOS 决定**（系统设置 → 通知 → DeepSeek Harness），未签名的开发版可能静默失败——「显示已授权却没通知」多半不是插件的问题。

## 🧩 设计与实现

给想改代码的人看的要点（实现细节以源码注释为准）：

- **触发不碰事件瀑布**：审批/提问的请求是 waterfall 事件，UI 应答后晚注册的监听器收不到。本插件改读 `uiSession.sessionStatus`（DSH 自己聚合的 pending/running 事实，与侧栏状态点同源），纯观察、零侵入。
- **重复提醒的节拍**：15 秒粒度检查未处理决策；**看过即除名**（决策出现时你正在窗口、或之后回到窗口，都算看过），切走不重新武装；新问题替换旧问题会重置计时。免打扰期间的提醒直接作废，不会顺延到时段结束补发。
- **通知点击回到窗口**：渲染进程唤不起 OS 窗口，点击时 POST 到宿主半边的 `/notify-sounds/focus`（带 connection 围栏），由宿主唤起。Windows 用 DSH 自带的 `koffi` 直接调 `user32.dll`（不引新依赖、只操作窗口、不启动 PowerShell——那会触发杀软主动防御并归因到 DSH）；桌面端/浏览器端按 `Origin` 头自动区分，浏览器端不误唤桌面窗口。
- **通知折叠**：不把 `tag` 交给平台（平台替换旧通知时会吞掉指向它的点击），由插件自己关旧发新，并持有每一代通知对象的引用，避免点击回调被回收成死按钮。
- **标题标记**：只做前缀加/删，与 DSH 自身的标题管理互不干扰；前缀按实际写入的文字记录，语言切换不叠加、不残留。「已完成」是未读消息——离开期间发生的完成才标记，回到页面即清除——不是常驻的「空闲」状态，看过的完成不会在每次切走时重新出现。macOS 桌面端按系统风格不画标题栏文字，同一份标记改由「窗口」菜单、Mission Control 和 Dock 窗口列表读出（见「已知边界」），所以那里的开关照常可用，只是行内文案说明去哪儿看。
- **免打扰即遗忘**：静音时段内发生的决策与完成不记账——不响、不通知、不打标题标记，时段结束也不补发；本该在时段内发出的重复提醒直接作废。
- **冷却与健壮性**：同一会话的同类触发 2 秒内不重复响（另一个会话的决策照常响）；音量经 `Number.isFinite` 防护（手改 YAML 的非法值回落默认）；写入被拒时控件回弹到已接受值并显示错误行；开关写入中禁用，防双击竞写。
- **音量滑杆**：非受控输入，拖动只写 CSS 自定义属性，松手才提交一次，不卡顿、不回弹。
- **主题与排版**：全部使用 `--dsw-alias-*` 令牌，分区与行几何复刻官方设置页；音效选择用官方 `Menu` 下拉，不会撑出横向滚动。

## 📜 更新记录

- **v1.9.7**（2026-11-27）**兼容 DSH 0.2.3-alpha**（[#8](https://github.com/BillCx330/dsh-plugin-notify-sounds/issues/8)，感谢 @zuosus）。两处接口在新版里换了形状：① 会话状态表被拆成独立服务，Cordis 现在拒绝未声明注入的属性读取，插件一加载就报 `cannot get property "uiSession.sessionStatus" without inject`；② `connection.requestRejection` 被删掉、只留 `admit`，而四条路由（点通知 / 检查更新 / 目标模式 / 音频上传）都靠它鉴权，第一次请求就会失败。改法是运行时自适应：状态表先按旧方式读、读不到再走服务注入；鉴权优先用旧方法、没有才调 `admit`。0.2.2 及更早走的是原来的路径，行为不变。
- **v1.9.6**（2026-11-22）**「仅离开页面时提示」现在真的包含失焦；macOS 上的标题提醒也恢复了**（[#6](https://github.com/BillCx330/dsh-plugin-notify-sounds/pull/6)、[#7](https://github.com/BillCx330/dsh-plugin-notify-sounds/pull/7)，感谢 @jasonwentf）。① 那个选项以前只看页面是否可见：窗口就摆在屏幕上、你在别的程序里打字时，它仍然算「可见」而保持沉默——现在改用和系统通知相同的判据（不可见 **或** 失焦），选项名与描述也一并改成「仅离开页面时提示」。② macOS 桌面版不绘制标题栏文字，过去因此把标题提醒整个禁用了；实际上窗口标题仍会出现在「窗口」菜单、Mission Control 和 Dock 的窗口列表里，所以开关恢复可用，行内提示写明去哪里看（这一部分由贡献者实测，Windows 侧的行为未改动）。
- **v1.9.5**（2026-11-07）**适配 DSH 0.2.2-rc.1：设置页的图标回来了，并且和相邻图标一样大。** 0.2.2 把导航格子改成 `<span>` 包图标，原来那套「找到 svg 再替换」的 DOM 写法匹配不上，图标退回默认齿轮；这一版正好开放了 `settings.section.icon` 插槽，改为按官方方式注册组件。顺手修了尺寸：原来的闹钟按 17 单位画、塞进 16px 槽位，缩了 6%，描边也从 1.3px 变成 1.22px，看着比邻居小一圈；现在按 16 单位重排坐标，描边回到 1.3px。0.2.1 仍走旧的 DOM 替换，两条路都保留。升级说明改成 0.2.2 的「插件页直接更新」；应用内的更新提示也按版本给最短路径：0.2.2 及以上只提示「点更新」，更早的版本才给卸载重装的完整步骤。README 里那条「插件市场一键更新」一并删掉了。

更早的 39 个版本见 [CHANGELOG.md](https://github.com/BillCx330/dsh-plugin-notify-sounds/blob/main/CHANGELOG.md)。
