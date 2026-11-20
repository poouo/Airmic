import { useState } from "react";
import { Alert, Button, Input, Modal } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

/** 游客原地升级为正式账号：保留当前 user id、房间身份与实时连接，不用退出重进 */
export default function UpgradeAccountModal() {
  const modal = useUiStore((state) => state.modal);
  if (modal !== "upgrade") return null;
  return <UpgradeAccountForm />;
}

function UpgradeAccountForm() {
  const user = useAuthStore((state) => state.user);
  const upgrade = useAuthStore((state) => state.upgrade);
  const closeModal = useUiStore((state) => state.closeModal);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const name = username.trim();
    if (name.length < 3 || name.length > 24 || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      setError("用户名 3-24 位，只能包含字母、数字、下划线和短横线");
      return;
    }
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await upgrade(name, password, displayName);
      closeModal();
      useUiStore.getState().toast("账号已升级为正式账号，当前房间与连接保持不变", "success", "升级成功");
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      useUiStore.getState().toast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={closeModal}
      title="升级为正式账号"
      subtitle="保留当前昵称、房间与语音连接，只是补一个可登录的账号"
      size="md"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={closeModal} disabled={saving}>
            稍后再说
          </Button>
          <Button size="sm" loading={saving} onClick={() => void submit()}>
            升级账号
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Alert tone="info">升级后可用用户名 + 密码在任意设备登录；当前房间无需退出重进。</Alert>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Input
          label="用户名"
          required
          value={username}
          maxLength={24}
          hint="3-24 位，字母、数字、下划线或短横线"
          onChange={(event) => setUsername(event.target.value)}
        />
        <Input
          label="昵称"
          value={displayName}
          maxLength={24}
          hint="其他人看到的名字，可随时再改"
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="密码"
            type="password"
            required
            value={password}
            maxLength={128}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Input
            label="确认密码"
            type="password"
            required
            value={confirm}
            maxLength={128}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
