import type { ServerSettingsPublic } from "@airmic/shared";
import { Globe, Radio, Server, ShieldCheck, Users } from "lucide-react";
import { Alert, SectionTitle } from "@/components/ui";
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
    <div className={cn("w-full flex-col justify-center gap-7 bg-muted/40 lg:p-10", className)}>
      <div>
        <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">{server?.name ?? "AirMic 语音服务器"}</h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">浏览器里的团队语音房，适合开黑、语音会议与一起听歌。</p>
      </div>

      <div className="rounded-2xl border border-border bg-card px-4 py-3.5 shadow-card">
        <SectionTitle>服务器公告</SectionTitle>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/85">{server?.motd || "欢迎来到 AirMic！"}</p>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-card">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Users className="h-3 w-3" /> 在线
          </div>
          <p className="tabular mt-1 text-lg font-semibold leading-6 text-foreground">{onlineCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-card">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Server className="h-3 w-3" /> 房间
          </div>
          <p className="tabular mt-1 text-lg font-semibold leading-6 text-foreground">{roomCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-card">
          <div className="text-[11px] text-muted-foreground">注册</div>
          <p className="mt-1 truncate text-sm font-semibold leading-6 text-foreground">{REGISTRATION_LABELS[registrationMode] ?? registrationMode}</p>
          {server && !server.guestEnabled && <p className="text-[10px] leading-4 text-muted-foreground">游客已关闭</p>}
        </div>
      </div>

      {setupRequired && (
        <Alert tone="info" title="首次部署">
          服务器还没有管理员，第一个注册的账号将自动成为管理员。
        </Alert>
      )}

      <div className="grid gap-4">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <div key={feature.title} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-card">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{feature.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{feature.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
