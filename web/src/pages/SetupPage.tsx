import { useCallback, useEffect, useState } from "react";
import type { SetupStatusResponse } from "@airmic/shared";
import { ArrowLeft, ArrowRight, Check, RefreshCw, ServerOff, Sparkles } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { Alert, Badge, Button, Divider, FullScreenLoader } from "@/components/ui";
import ThemeToggle from "@/components/layout/ThemeToggle";
import SetupAdminStep from "@/components/setup/SetupAdminStep";
import SetupConfirmStep from "@/components/setup/SetupConfirmStep";
import SetupServerStep from "@/components/setup/SetupServerStep";
import SetupShell from "@/components/setup/SetupShell";
import SetupStepper from "@/components/setup/SetupStepper";
import SetupVoiceStep from "@/components/setup/SetupVoiceStep";
import { SETUP_STEPS, buildInitializeRequest, createInitialForm, validateStep, type SetupFormState } from "@/components/setup/types";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";

/** 部署后初始化向导（/setup）：未登录可访问，完成后自动登录管理员 */
export default function SetupPage() {
  const navigate = useNavigate();
  const authStatus = useAuthStore((state) => state.status);
  const [status, setStatus] = useState<SetupStatusResponse | null>(null);
  const [form, setForm] = useState<SetupFormState | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await api.setup.status();
      setStatus(result);
      setForm((previous) => previous ?? createInitialForm(result));
    } catch (caught) {
      setLoadError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  if (loading) {
    return (
      <>
        <ThemeToggle className="fixed right-4 top-4 z-20" />
        <FullScreenLoader text="正在检查服务器初始化状态…" />
      </>
    );
  }

  if (loadError) {
    return (
      <SetupShell>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <ServerOff className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">无法连接服务器</p>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{loadError}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">请确认后端服务已启动（默认端口 9811），然后重试</p>
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void loadStatus()}>
            重试
          </Button>
        </div>
      </SetupShell>
    );
  }

  if (status && !status.setupRequired) {
    if (authStatus === "loading") {
      return (
        <>
          <ThemeToggle className="fixed right-4 top-4 z-20" />
          <FullScreenLoader text="正在跳转…" />
        </>
      );
    }
    return <Navigate to={authStatus === "authenticated" ? "/" : "/login"} replace />;
  }

  if (!status || !form) {
    return (
      <>
        <ThemeToggle className="fixed right-4 top-4 z-20" />
        <FullScreenLoader text="正在准备初始化向导…" />
      </>
    );
  }

  const currentStep = SETUP_STEPS[step] ?? SETUP_STEPS[0];
  const isLastStep = step === SETUP_STEPS.length - 1;

  const update = (patch: Partial<SetupFormState>) => {
    setStepError(null);
    setForm((previous) => (previous ? { ...previous, ...patch } : previous));
  };

  const goPrevious = () => {
    if (submitting) return;
    setStepError(null);
    setStep((value) => Math.max(0, value - 1));
  };

  const goNext = () => {
    const message = validateStep(step, form, status.requiresToken);
    if (message) {
      setStepError(message);
      return;
    }
    setStepError(null);
    setStep((value) => Math.min(SETUP_STEPS.length - 1, value + 1));
  };

  const handleSelectStep = (index: number) => {
    if (submitting) return;
    setStepError(null);
    setStep(index);
  };

  const handleSubmit = async () => {
    for (let index = 0; index < SETUP_STEPS.length - 1; index += 1) {
      const message = validateStep(index, form, status.requiresToken);
      if (message) {
        setStep(index);
        setStepError(message);
        return;
      }
    }
    setSubmitting(true);
    setStepError(null);
    try {
      const result = await api.setup.initialize(buildInitializeRequest(form, status.requiresToken));
      useAuthStore.getState().setUser(result.user);
      useAppStore.getState().setServer(result.server);
      useAppStore.getState().setRooms(result.rooms);
      useAppStore.setState({ setupRequired: false, bootstrapped: true });
      useUiStore.getState().toast("服务器初始化完成，欢迎使用 AirMic！", "success", "初始化成功", 5000);
      navigate("/", { replace: true });
    } catch (caught) {
      const message = errorMessage(caught);
      setStepError(message);
      useUiStore.getState().toast(message, "error");
      if (caught instanceof ApiError) {
        if (caught.code === "setup_completed") {
          // 已被其他请求完成初始化：刷新状态后会自动跳转
          void loadStatus();
          return;
        }
        if (caught.code === "setup_token_invalid") {
          setStep(0);
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SetupShell>
      <SetupStepper current={step} onSelect={handleSelectStep} />

      <Divider className="my-5" />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            第 {step + 1} 步 · {currentStep.title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{currentStep.description}</p>
        </div>
        <Badge>
          <Sparkles className="h-3 w-3" />
          共 {SETUP_STEPS.length} 步
        </Badge>
      </div>

      {step === 0 && <SetupServerStep form={form} update={update} disabled={submitting} requiresToken={status.requiresToken} />}
      {step === 1 && <SetupAdminStep form={form} update={update} disabled={submitting} />}
      {step === 2 && <SetupVoiceStep form={form} update={update} disabled={submitting} />}
      {step === 3 && <SetupConfirmStep form={form} requiresToken={status.requiresToken} status={status} />}

      {stepError && (
        <div className="mt-4" role="alert">
          <Alert tone="error">{stepError}</Alert>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
        <Button variant="ghost" onClick={goPrevious} disabled={step === 0 || submitting} icon={<ArrowLeft className="h-4 w-4" />}>
          上一步
        </Button>
        <div className="flex items-center gap-3">
          <span className="hidden text-[11px] text-muted-foreground sm:block">
            第 {step + 1} / {SETUP_STEPS.length} 步
          </span>
          {isLastStep ? (
            <Button loading={submitting} onClick={() => void handleSubmit()} icon={<Check className="h-4 w-4" />}>
              完成初始化
            </Button>
          ) : (
            <Button onClick={goNext} disabled={submitting}>
              下一步
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </SetupShell>
  );
}
