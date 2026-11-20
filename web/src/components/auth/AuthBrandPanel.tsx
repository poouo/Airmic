import type { ServerSettingsPublic } from "@airmic/shared";
import { Globe, MessageSquare, Mic, Radio, Server, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/format";

const REGISTRATION_LABELS: Record<string, string> = {
  open: "开放注册",
  invite: "邀请码注册",
  closed: "暂停注册",
};

const FEATURES = [
  { icon: Globe, title: "打开网页就能开黑", description: "无需下载客户端，浏览器直接进入语音房间" },
  { icon: Radio, title: "服务端语音中转", description: "低延迟 LiveKit SFU，支持屏幕共享与文字聊天" },
  { icon: ShieldCheck, title: "权限与内容可控", description: "管理员可配置注册、游客、房间与音质策略" },
  { icon: MessageSquare, title: "频道与聊天", description: "按分类整理房间，房间内实时文字消息" },
];

export interface AuthBrandPanelProps {
  server: ServerSettingsPublic | null;
  onlineCount: number;
  roomCount: number;
  setupRequired: boolean;
  className?: string;
}

export default function AuthBrandPanel({ server, onlineCount, roomCount, setupRequired, className }: AuthBrandPanelProps) {
  const registrationMode = server?.registrationMode ?? "open";
  return (
    <div className={cn("flex w-full max-w-lg flex-col gap-6", className)}>
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-aqua-500 shadow-lg shadow-brand-500/30">
            <Mic className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-mist-100">
                Air<span className="text-gradient">Mic</span>
              </h1>
              <Badge tone="brand">v{server?.version ?? "1.0.0"}</Badge>
            </div>
            <p className="text-xs text-mist-400">网页语音开黑 · 打开即聊</p>
          </div>
        </div>

        <h2 className="mt-7 text-3xl font-bold leading-tight text-mist-100 sm:text-4xl">{server?.name ?? "AirMic 语音服务器"}</h2>
        <p className="mt-2 text-sm text-mist-400">浏览器里的团队语音房，适合开黑、语音会议与一起听歌。</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-4 backdrop-blur">
        <div className="flex items-center gap-1.5 text-xs font-medium text-brand-300">
          <Sparkles className="h-3.5 w-3.5" />
          服务器公告
        </div>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-mist-300">{server?.motd || "欢迎来到 AirMic！"}</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-white/5 bg-ink-850 px-3 py-3">
          <div className="flex items-center gap-1.5 text-[11px] text-mist-500">
            <Users className="h-3 w-3" /> 在线
          </div>
          <p className="mt-1 text-xl font-semibold text-mist-100">{onlineCount}</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-ink-850 px-3 py-3">
          <div className="flex items-center gap-1.5 text-[11px] text-mist-500">
            <Server className="h-3 w-3" /> 房间
          </div>
          <p className="mt-1 text-xl font-semibold text-mist-100">{roomCount}</p>
        </div>
        <div className="rounded-2xl border border-white/5 bg-ink-850 px-3 py-3">
          <div className="text-[11px] text-mist-500">注册</div>
          <p className="mt-1 truncate text-sm font-semibold text-mist-100">{REGISTRATION_LABELS[registrationMode] ?? registrationMode}</p>
          {server && !server.guestEnabled && <p className="mt-0.5 text-[10px] text-mist-500">游客已关闭</p>}
        </div>
      </div>

      {setupRequired && (
        <div className="rounded-2xl border border-aqua-400/30 bg-aqua-400/10 px-4 py-3">
          <p className="text-sm font-medium text-aqua-400">首次部署</p>
          <p className="mt-1 text-xs leading-relaxed text-mist-300">服务器还没有管理员，第一个注册的账号将自动成为管理员。</p>
        </div>
      )}

      <div className="hidden gap-3 sm:grid sm:grid-cols-2">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <div key={feature.title} className="rounded-2xl border border-white/5 bg-ink-850/70 p-3">
              <Icon className="h-4 w-4 text-brand-400" />
              <p className="mt-2 text-xs font-medium text-mist-200">{feature.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-mist-500">{feature.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
