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
  onCodeSubmit: (code: string) => void;
}

/** 进入房间前的状态页：加载中 / 密码 / 加入失败 */
export function JoinGate({ roomName, joining, error, connection, onRetry, onBack, onPasswordSubmit, onCodeSubmit }: JoinGateProps) {
  const needsPassword = error !== null && error.code.startsWith("room_password_");
  const needsCode = error !== null && error.code.startsWith("room_code_");
  const [password, setPassword] = useState("");
  const valid = needsCode ? /^\d{4}$/.test(password) : password.length > 0;

  useEffect(() => {
    setPassword("");
  }, [error?.code]);

  return (
    <div className="app-scroll flex h-full min-h-0 flex-col items-center overflow-y-auto overscroll-y-contain p-4">
      <div className="my-auto w-full max-w-md shrink-0 rounded-2xl border border-border bg-card p-6 shadow-card">
        {joining ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <Spinner className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">正在加入 {roomName ? "「" + roomName + "」" : "房间"}…</p>
              <p className="mt-1 text-xs text-muted-foreground">正在建立实时连接并同步房间成员</p>
            </div>
          </div>
        ) : (needsPassword || needsCode) && error ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!valid || connection !== "online") return;
              if (needsCode) onCodeSubmit(password);
              else onPasswordSubmit(password);
            }}
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{needsCode ? "该房间需要四位口令" : "该房间需要密码"}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {roomName ? "「" + roomName + "」" : "房间"}{needsCode ? " · 口令房" : "已设置访问密码，请输入后加入"}
                </p>
              </div>
            </div>
            <Input
              type={needsCode ? "text" : "password"}
              inputMode={needsCode ? "numeric" : undefined}
              autoComplete="off"
              autoFocus
              value={password}
              placeholder={needsCode ? "输入四位口令" : "请输入房间密码"}
              onChange={(event) => setPassword(needsCode ? event.target.value.replace(/\D/g, "").slice(0, 4) : event.target.value)}
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
                disabled={!valid || connection !== "online"}
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
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <WifiOff className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">无法加入房间</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
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
    <p className="rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] text-warning">
      实时连接状态：{connection === "reconnecting" ? "正在重新连接服务器" : connection === "connecting" ? "正在连接服务器" : "已断开"}
      ，连接恢复后即可重试。
    </p>
  );
}
