import { AUDIO_PRESET_LIST, type SetupStatusResponse } from "@airmic/shared";
import { CheckCircle2, RadioTower, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/format";
import { REGISTRATION_LABELS, type SetupFormState } from "./types";

export interface SetupConfirmStepProps {
  form: SetupFormState;
  requiresToken: boolean;
  status: SetupStatusResponse;
}

function SummaryRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
      <span className="shrink-0 text-mist-500">{label}</span>
      <span className={cn("min-w-0 break-all text-right font-medium text-mist-200", mono && "font-mono text-[11px]")}>{value}</span>
    </div>
  );
}

/** 第 4 步：确认摘要 */
export default function SetupConfirmStep({ form, requiresToken, status }: SetupConfirmStepProps) {
  const presetLabel = AUDIO_PRESET_LIST.find((preset) => preset.id === form.preset)?.label ?? form.preset;
  const voiceConfigured = Boolean(form.livekitUrl.trim() && form.livekitApiKey.trim() && form.livekitApiSecret.trim());

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-mist-400">请确认以下配置，点击「完成初始化」后将立即创建管理员账号并生效。</p>

      <div className="space-y-3">
        <section className="rounded-xl border border-white/10 bg-ink-900/40 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-mist-200">
            <CheckCircle2 className="h-3.5 w-3.5 text-brand-300" />
            服务器信息
          </h3>
          <div className="grid gap-1.5 text-xs sm:grid-cols-2">
            <SummaryRow label="服务器名称" value={form.name.trim() || "（未填写）"} />
            <SummaryRow label="注册模式" value={REGISTRATION_LABELS[form.registrationMode]} />
            <SummaryRow label="游客登录" value={form.guestEnabled ? "允许" : "不允许"} />
            <SummaryRow label="默认房间" value={form.createDefaultRooms ? "自动创建（开黑大厅 / 休息室）" : "不创建"} />
          </div>
          {form.motd.trim() && <p className="mt-2 whitespace-pre-line rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-[11px] leading-relaxed text-mist-300">{form.motd}</p>}
        </section>

        <section className="rounded-xl border border-white/10 bg-ink-900/40 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-mist-200">
            <ShieldCheck className="h-3.5 w-3.5 text-aqua-400" />
            管理员账号
          </h3>
          <div className="grid gap-1.5 text-xs sm:grid-cols-2">
            <SummaryRow label="用户名" value={form.username.trim() || "（未填写）"} />
            <SummaryRow label="昵称" value={form.displayName.trim() || form.username.trim() || "（未填写）"} />
            <SummaryRow label="账号角色" value="管理员（全部权限）" />
            <SummaryRow label="密码" value="已设置（保密）" />
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-ink-900/40 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-mist-200">
            <RadioTower className="h-3.5 w-3.5 text-brand-300" />
            语音与音质
          </h3>
          <div className="grid gap-1.5 text-xs sm:grid-cols-2">
            <SummaryRow label="传输方式" value="SFU 服务端中转（不做 P2P）" />
            <SummaryRow label="LiveKit 地址" value={form.livekitUrl.trim() || "未配置（可稍后在管理后台配置）"} mono={Boolean(form.livekitUrl.trim())} />
            <SummaryRow label="LiveKit 凭据" value={voiceConfigured ? "已填写" : "未填写"} />
            <SummaryRow label="单房间人数上限" value={form.maxUsersPerRoom ? form.maxUsersPerRoom + " 人" : "（未填写）"} />
            <SummaryRow label="默认音质" value={presetLabel} />
            <SummaryRow label="服务器版本" value={"v" + status.server.version} />
          </div>
          {!voiceConfigured && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-warn-500/30 bg-warn-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-warn-400">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              未配置 LiveKit 语音中转服务，初始化后房间内将无法通话；可稍后在管理后台「服务器设置 → 语音中转（SFU）」中补充。
            </div>
          )}
        </section>

        {requiresToken && (
          <section className="rounded-xl border border-warn-500/30 bg-warn-500/5 px-3 py-2 text-xs text-mist-300">
            初始化口令：{form.token.trim() ? "已填写" : "未填写"}
          </section>
        )}
      </div>
    </div>
  );
}
