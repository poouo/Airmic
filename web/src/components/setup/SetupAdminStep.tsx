import { Alert, Input } from "@/components/ui";
import type { SetupStepProps } from "./types";

/** 第 2 步：管理员账号 */
export default function SetupAdminStep({ form, update, disabled }: SetupStepProps) {
  return (
    <div className="space-y-4">
      <Alert tone="info">该账号将成为服务器第一个管理员，拥有全部管理权限；请妥善保管账号密码。</Alert>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="管理员用户名"
          required
          value={form.username}
          maxLength={24}
          autoComplete="username"
          placeholder="admin"
          hint="3 - 24 位字母、数字、下划线或短横线"
          disabled={disabled}
          onChange={(event) => update({ username: event.target.value })}
        />
        <Input
          label="管理员昵称"
          value={form.displayName}
          maxLength={24}
          autoComplete="nickname"
          placeholder="例如：服主（可选）"
          hint="留空则使用用户名，最多 24 个字符"
          disabled={disabled}
          onChange={(event) => update({ displayName: event.target.value })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="密码"
          required
          type="password"
          autoComplete="new-password"
          value={form.password}
          maxLength={128}
          placeholder="至少 6 位"
          hint="至少 6 位，最多 128 位"
          disabled={disabled}
          onChange={(event) => update({ password: event.target.value })}
        />
        <Input
          label="确认密码"
          required
          type="password"
          autoComplete="new-password"
          value={form.confirmPassword}
          maxLength={128}
          placeholder="再次输入密码"
          disabled={disabled}
          onChange={(event) => update({ confirmPassword: event.target.value })}
        />
      </div>
    </div>
  );
}
