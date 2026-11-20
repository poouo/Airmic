# AirMic Web UI 重构规范（2026-11）

本文件是 UI 重构期间的唯一视觉与实现约定。所有页面组件必须遵守，不再出现旧色板与旧装饰。

参考视觉语言：`D:\Forwardx\Forwardx`（浅色中性底、白色圆角卡片、1px 细边框、近黑主按钮、克制的状态色、紧凑排版与充足留白）。
注意：只借鉴视觉语言，**不要复制 ForwardX 的源码**（其许可证为 AGPL-3.0，AirMic 需保持自身实现）。

## 1. 设计令牌

令牌定义在 `web/src/styles.css`，通过 Tailwind v4 生成工具类（支持 `/10` 等透明度修饰符）。

| 令牌 | 用途 |
| --- | --- |
| `background` / `foreground` | 页面底色与正文颜色 |
| `card` / `card-foreground` | 卡片、面板、输入框底色 |
| `popover` / `popover-foreground` | 弹窗、下拉浮层 |
| `primary` / `primary-foreground` | 主按钮（近黑）与其上的文字 |
| `secondary` / `secondary-foreground` | 次级按钮、次级底 |
| `muted` / `muted-foreground` | 弱化底色、说明文字、表头 |
| `accent` / `accent-foreground` | hover 底色、选中态底色 |
| `border` / `input` / `ring` | 边框、输入框边框、聚焦环 |
| `success` / `warning` / `destructive` / `info` | 在线、警告、错误、信息 |
| `brand` | AirMic 品牌强调色（少量使用，禁止大面积渐变） |
| `sidebar` / `sidebar-foreground` / `sidebar-accent` / `sidebar-border` | 侧栏 |
| `chart-1..5` | 图表/音质条等数据色 |

圆角：卡片 `rounded-2xl`，按钮/输入框 `rounded-field`（10px），小徽章 `rounded` / `rounded-md`。
阴影：卡片 `shadow-card`，浮层 `shadow-popover`，禁止 `shadow-2xl shadow-black/50` 这类重阴影。

## 2. 基础组件（`@/components/ui`）

已有导出，**优先复用，不要自己造轮子**：

`Button`（primary/secondary/ghost/outline/danger/success，size sm/md/lg，`loading`/`icon`/`fullWidth`）、
`IconButton`（`label` 必填，size sm/md/lg，variant ghost/solid/danger）、
`FieldShell`、`Input`、`Textarea`、`Select`、`Switch`、`Slider`、`Avatar`、
`Card`、`CardHeader`、`CardContent`、`CardFooter`、`PageHeader`、`StatCard`、`Alert`、
`Badge`（tone neutral/brand/good/warn/bad）、`Spinner`、`Skeleton`、`FullScreenLoader`、`EmptyState`、
`Tabs`（+ `TabItem`）、`Kbd`、`Divider`、`SectionTitle`、
`Modal`、`ToastHost`、`ConfirmDialog`。

用法示例：

```tsx
<PageHeader
  title="用户管理"
  description="管理账号、角色与封禁状态。"
  actions={<Button icon={<Plus className="h-4 w-4" />}>新建用户</Button>}
/>

<Card>
  <CardHeader title="房间设置" description="修改后立即生效。" action={<Badge tone="good">已保存</Badge>} />
  <CardContent className="space-y-4">
    <Input label="房间名称" value={name} onChange={(e) => setName(e.target.value)} />
  </CardContent>
  <CardFooter>
    <Button variant="outline" size="sm">取消</Button>
    <Button size="sm">保存</Button>
  </CardFooter>
</Card>
```

## 3. 页面骨架

内容区已由 `AppLayout` 提供滚动容器，页面自身只负责内边距与栅格：

```tsx
<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
  {/* 内容 */}
</div>
```

- 页面标题统一用 `PageHeader`，不要再手写 `<h1 className="text-3xl font-bold ...">`。
- 分节标题用 `text-base font-semibold tracking-tight`；小节标题可用 `SectionTitle`（全大写小字）。
- 正文 14px（默认），说明文字 `text-sm text-muted-foreground`，最小可用 `text-xs`。
- 数字统计加 `tabular` 类，保证不跳动。
- 卡片之间用 `gap-4`/`gap-6`，内部内边距 `p-5`/`px-5 py-4`，不要再出现 `p-8` 的大留白。

## 4. 表格

```tsx
<div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-card">
  <table className="w-full min-w-[640px] text-sm">
    <thead>
      <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
        <th className="px-4 py-2.5 text-left font-medium">名称</th>
        <th className="px-4 py-2.5 text-right font-medium">操作</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-border">
      <tr className="transition-colors hover:bg-muted/40">
        <td className="px-4 py-3 font-medium text-foreground">大厅</td>
        <td className="px-4 py-3 text-right">…</td>
      </tr>
    </tbody>
  </table>
</div>
```

## 5. 禁止出现（旧设计残留）

- 旧色板类名：`ink-*`、`mist-*`、`brand-400`（旧色阶）、`aqua-*`、`good-*`、`bad-*`、`warn-*`
- 半透明白：`bg-white/5`、`border-white/10`、`ring-white/5` 等
- 装饰类：`bg-grid`、`glass-panel`、`text-gradient`、`shadow-black/*`、`bg-gradient-to-*` 紫色/青色渐变
- 超大标题（`text-4xl` 以上）、霓虹光晕、`blur-3xl` 光斑装饰、`tracking-widest` 大标题

允许的例外：`bg-black/40` 之类遮罩请改用 `bg-foreground/25 dark:bg-black/50`。

## 6. 页面方向

### 登录 / 注册 / 游客（`pages/AuthPage.tsx` + `components/auth/*`）
左右分栏：左侧品牌展示区（近黑或浅灰底 + 产品名 + 一句话说明 + 3 条特性），右侧表单卡片（白底、圆角 2xl、细边框），顶部右上角放语言/主题等工具。
移动端退化为单列卡片。表单字段用 `Input`/`Button`，错误用 `Alert`，底部切换登录/注册/游客用 `Tabs`。

### 初始化向导（`pages/SetupPage.tsx` + `components/setup/*`）
顶部品牌 + 步骤条（已完成=实心近黑，当前=描边，未到=灰），中间一张宽卡片承载步骤内容，底部「上一步 / 下一步」按钮。整体留白充足、文案层级清晰。

### 房间大厅（`pages/LobbyPage.tsx` + `components/lobby/*`）
`PageHeader`（欢迎语 + 服务器名 + 操作按钮）+ 一行统计徽章；房间按分类分组，卡片网格（`grid gap-4 sm:grid-cols-2 xl:grid-cols-3`）。
房间卡片：名称 + 状态徽章 + 简介 + 元信息行（人数/分享/聊天，小图标 + muted 文字）+ 底部「进入房间」主按钮与编辑图标按钮。
有密码/锁定状态用 `Badge` 与 `Lock` 图标表达，不要彩色光晕。

### 语音房间（`pages/RoomPage.tsx` + `components/room/*`、`components/chat/*`）
顶部房间头（返回、房间名、状态徽章、关键词元信息、操作按钮），中间成员网格（白色卡片，头像 + 名字 + 角色徽章 + 麦克风/说话状态 + 音量滑杆），
底部控制条（圆角胶囊、白底细边框、麦克风/耳机/屏幕共享/聊天/设置/离开，危险操作用 destructive），右侧聊天面板（`w-80`，消息列表 + 输入框 + 发送按钮）。
说话高亮使用 `.speaking-ring`（绿色描边），不要霓虹紫。

### 管理后台（`pages/AdminPage.tsx` + `components/admin/*`）
左侧二级导航（白底卡片或 sidebar 风格，当前项 `bg-accent font-medium`）+ 右侧内容。
概览用 `StatCard` 网格；列表页统一用上面的表格规范；表单用 `Card` + `FieldShell`；危险操作按钮 `variant="danger"` 且需要确认弹窗。

### 语音设置弹窗（`components/settings/*`）
`Modal size="xl"`：左侧纵向 tab 列表（图标 + 名称，当前项 `bg-accent`），右侧内容区。控件成组，用 `Divider` 分隔，说明文字 muted。

### 个人资料弹窗（`components/profile/ProfileModal.tsx`）
`Modal size="lg"`：头像预览 + 昵称/状态/颜色/emoji 表单，保存/取消在 footer。

## 7. 交付要求

1. **不改行为**：所有 props、hook、zustand selector、API 调用、WebSocket 事件、语音逻辑、表单校验、toast 文案、aria-label、`data-testid` 必须保持原样；只改 JSX 结构与 className。
2. 文案保持中文原样；允许把不统一的大小写/标点统一，不允许改变功能含义。
3. 需要新基础组件时，先看 `ui/index.tsx` 是否已有；没有就在本页内联实现，不要改共享文件。
4. 不要新增依赖，不要改 `styles.css`、`components/ui/index.tsx`、`components/layout/*`（这些由集成方维护）。
5. 完成后在回复里列出：改动文件、是否有行为风险点、建议截图检查的页面。
