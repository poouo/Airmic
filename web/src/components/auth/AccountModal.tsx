import { useEffect } from "react";
import { Alert, Modal } from "@/components/ui";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import LoginForm from "./LoginForm";
import RegisterForm from "./RegisterForm";

export default function AccountModal({ mode }: { mode: "login" | "register" }) {
  const user = useAuthStore((state) => state.user);
  const error = useAuthStore((state) => state.error);
  const submitting = useAuthStore((state) => state.submitting);
  const clearError = useAuthStore((state) => state.clearError);
  const close = useUiStore((state) => state.closeModal);
  const registrationMode = useAppStore((state) => state.server?.registrationMode ?? "open");

  useEffect(() => {
    clearError();
  }, [clearError]);
  useEffect(() => {
    if (user && !user.isGuest) close();
  }, [close, user]);

  return (
    <Modal open title={mode === "login" ? "登录已有账号" : "注册账号"} size="lg" onClose={submitting ? () => undefined : close}>
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        {mode === "login" ? <LoginForm /> : <RegisterForm registrationMode={registrationMode} />}
      </div>
    </Modal>
  );
}
