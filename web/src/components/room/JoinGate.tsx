import { useEffect, useState } from "react";
import { ArrowLeft, KeyRound, LogIn, RefreshCw, WifiOff } from "lucide-react";
import { Button, Input, Spinner } from "@/components/ui";
import type { SocketStatus } from "@/lib/ws";

export interface JoinGateError {
  code: string;
  message: string;
}

export interface JoinGateProps {
  roomName?: string | null;
  joining: boolean;
  error: JoinGateError | null;
  connection: SocketStatus;
  onRetry: () => void;
  onBack: () => void;
  onPasswordSubmit: (password: string) => void;
}

/** 进入房间前的状态页：加载中 / 密码 / 加入失败 */
export function JoinGate({ roomName, joining, error, connection, onRetry, onBack, onPasswordSubmit }: JoinGateProps) {
  const needsPassword = error !== null && error.code.startsWith("room_password_");
  const [password, setPassword] = useState("");

  useEffect(() => {
    setPassword("");
  }, [error?.code]);

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-4 app-scroll">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-ink-850 p-6 shadow-2xl shadow-black/50">
        {joining ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-800 ring-1 ring-white/10">
              <Spinner className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-mist-100">正在加入 {roomName ? "「" + roomName + "」" : "房间"}…</p>
              <p className="mt-1 text-xs text-mist-500">正在建立实时连接并同步房间成员</p>
            </div>
          </div>
        ) : needsPassword && error ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onPasswordSubmit(password);
            }}
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 text-brand-300 ring-1 ring-brand-400/30">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-mist-100">该房间需要密码</p>
                <p className="mt-1 text-xs text-mist-500">
                  {roomName ? "「" + roomName + "」" : "房间"}已设置访问密码，请输入后加入
                </p>
              </div>
            </div>
            <Input
              type="password"
              autoFocus
              value={password}
              placeholder="请输入房间密码"
              onChange={(event) => setPassword(event.target.value)}
              error={error.message}
            />
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="md" type="button" onClick={onBack} icon={<ArrowLeft className="h-4 w-4" />}>
                返回大厅
              </Button>
              <Button
                type="submit"
                size="md"
                className="flex-1"
                loading={joining}
                disabled={!password || connection !== "online"}
                icon={<LogIn className="h-4 w-4" />}
              >
                加入房间
              </Button>
            </div>
            {connection !== "online" && <FailedHint connection={connection} />}
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-bad-500/15 text-bad-400 ring-1 ring-bad-500/30">
                <WifiOff className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-mist-100">无法加入房间</p>
                <p className="mt-1 text-xs leading-relaxed text-mist-400">
                  {error?.message ?? "实时连接尚未建立，请稍后重试或返回大厅。"}
                </p>
              </div>
            </div>
            {connection !== "online" && <FailedHint connection={connection} />}
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="md" onClick={onBack} icon={<ArrowLeft className="h-4 w-4" />}>
                返回大厅
              </Button>
              <Button
                size="md"
                className="flex-1"
                onClick={onRetry}
                disabled={connection !== "online"}
                icon={<RefreshCw className="h-4 w-4" />}
              >
                重新尝试
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FailedHint({ connection }: { connection: SocketStatus }) {
  if (connection === "online") return null;
  return (
    <p className="rounded-xl bg-warn-500/10 px-3 py-2 text-[11px] text-warn-400 ring-1 ring-warn-500/20">
      实时连接状态：{connection === "reconnecting" ? "正在重新连接服务器" : connection === "connecting" ? "正在连接服务器" : "已断开"}
      ，连接恢复后即可重试。
    </p>
  );
}
