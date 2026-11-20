import type { RegistrationMode } from "@airmic/shared";
import { Input, Select, Switch, Textarea } from "@/components/ui";
import { REGISTRATION_OPTIONS, type SetupStepProps } from "./types";

export interface SetupServerStepProps extends SetupStepProps {
  requiresToken: boolean;
}

/** 第 1 步：服务器信息 */
export default function SetupServerStep({ form, update, disabled, requiresToken }: SetupServerStepProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="服务器名称"
          required
          value={form.name}
          maxLength={60}
          placeholder="周末开黑基地"
          hint="展示在登录页与客户端顶栏"
          disabled={disabled}
          onChange={(event) => update({ name: event.target.value })}
        />
        <Select
          label="注册模式"
          options={REGISTRATION_OPTIONS}
          value={form.registrationMode}
          disabled={disabled}
          hint="决定新用户如何加入服务器"
          onChange={(event) => update({ registrationMode: event.target.value as RegistrationMode })}
        />
      </div>

      <Textarea
        label="服务器公告（MOTD）"
        rows={3}
        maxLength={500}
        value={form.motd}
        placeholder="欢迎来到 AirMic！打开网页就能开黑，无需下载客户端。"
        hint="展示在登录页与大厅欢迎区，支持换行，最多 500 个字符"
        disabled={disabled}
        onChange={(event) => update({ motd: event.target.value })}
      />

      <div className="rounded-xl border border-white/10 bg-ink-900/40 p-3">
        <Switch
          label="允许游客登录"
          description="开启后无需注册即可用游客身份进入服务器"
          checked={form.guestEnabled}
          disabled={disabled}
          onChange={(guestEnabled) => update({ guestEnabled })}
        />
      </div>

      {requiresToken && (
        <div className="rounded-xl border border-warn-500/30 bg-warn-500/5 p-3">
          <Input
            label="初始化口令"
            required
            type="password"
            autoComplete="off"
            value={form.token}
            maxLength={200}
            placeholder="请输入服务器初始化口令"
            hint="服务器通过 SETUP_TOKEN 环境变量要求初始化口令"
            disabled={disabled}
            onChange={(event) => update({ token: event.target.value })}
          />
        </div>
      )}
    </div>
  );
}
