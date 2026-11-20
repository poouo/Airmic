import { useCallback, useEffect, useState } from "react";
import type { SetupStatusResponse } from "@airmic/shared";
import { ArrowLeft, ArrowRight, Check, RefreshCw, ServerOff, Sparkles } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, FullScreenLoader } from "@/components/ui";
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

  if (loading) return <FullScreenLoader text="正在检查服务器初始化状态…" />;

  if (loadError) {
    return (
      <SetupShell>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <ServerOff className="h-8 w-8 text-mist-500" />
          <p className="text-sm font-medium text-mist-200">无法连接服务器</p>
          <p className="max-w-md text-xs leading-relaxed text-mist-500">{loadError}</p>
          <p className="text-[11px] text-mist-500">请确认后端服务已启动（默认端口 9811），然后重试</p>
          <Button variant="outline" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void loadStatus()}>
            重试
          </Button>
        </div>
      </SetupShell>
    );
  }

  if (status && !status.setupRequired) {
    if (authStatus === "loading") return <FullScreenLoader text="正在跳转…" />;
    return <Navigate to={authStatus === "authenticated" ? "/" : "/login"} replace />;
  }

  if (!status || !form) return <FullScreenLoader text="正在准备初始化向导…" />;

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

      <div className="my-4 h-px bg-white/5" />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-mist-100">
            第 {step + 1} 步 · {currentStep.title}
          </h2>
          <p className="mt-0.5 text-xs text-mist-500">{currentStep.description}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-[10px] text-mist-400">
          <Sparkles className="h-3 w-3 text-brand-300" />
          共 {SETUP_STEPS.length} 步
        </span>
      </div>

      {step === 0 && <SetupServerStep form={form} update={update} disabled={submitting} requiresToken={status.requiresToken} />}
      {step === 1 && <SetupAdminStep form={form} update={update} disabled={submitting} />}
      {step === 2 && <SetupVoiceStep form={form} update={update} disabled={submitting} />}
      {step === 3 && <SetupConfirmStep form={form} requiresToken={status.requiresToken} status={status} />}

      {stepError && (
        <div className="mt-4 rounded-xl border border-bad-500/30 bg-bad-500/10 px-3 py-2.5 text-xs leading-relaxed text-bad-400" role="alert">
          {stepError}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-2 border-t border-white/5 pt-4">
        <Button variant="ghost" onClick={goPrevious} disabled={step === 0 || submitting} icon={<ArrowLeft className="h-4 w-4" />}>
          上一步
        </Button>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-mist-500 sm:block">
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
