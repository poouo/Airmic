import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn, colorWithAlpha, initials } from "@/lib/format";
import { useUiStore, type ToastType } from "@/stores/ui";

// ============ Button ============

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-brand-600 to-brand-500 text-white shadow-[0_8px_24px_-10px_rgba(99,102,241,0.8)] hover:from-brand-500 hover:to-brand-400 focus-visible:ring-brand-400",
  secondary: "bg-ink-700/80 text-mist-100 border border-white/10 hover:bg-ink-600 focus-visible:ring-ink-500",
  ghost: "text-mist-300 hover:bg-white/5 hover:text-mist-100 focus-visible:ring-white/20",
  danger: "bg-bad-500 text-white hover:bg-bad-400 focus-visible:ring-bad-400",
  success: "bg-good-500 text-ink-950 hover:bg-good-400 focus-visible:ring-good-400",
  outline: "border border-white/15 text-mist-200 hover:border-white/30 hover:bg-white/5 focus-visible:ring-white/20",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-base gap-2.5 rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  fullWidth = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center font-medium outline-none transition-all duration-150",
        "focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
        "disabled:cursor-not-allowed disabled:opacity-50",
        buttonVariants[variant],
        buttonSizes[size],
        fullWidth && "w-full",
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "solid" | "danger";
  active?: boolean;
}

export function IconButton({ label, size = "md", variant = "ghost", active, className, children, ...rest }: IconButtonProps) {
  const sizeClass = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  return (
    <button
      {...rest}
      title={rest.title ?? label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center justify-center rounded-xl outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-brand-400",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variant === "ghost" && "text-mist-300 hover:bg-white/5 hover:text-mist-100",
        variant === "solid" && "bg-ink-700/80 text-mist-200 ring-1 ring-white/10 hover:bg-ink-600",
        variant === "danger" && "text-bad-400 hover:bg-bad-500/10 hover:text-bad-400",
        active && "bg-brand-500/15 text-brand-300 ring-1 ring-brand-400/30",
        sizeClass,
        className,
      )}
    >
      {children}
    </button>
  );
}

// ============ Form ============

export interface FieldShellProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

export function FieldShell({ label, hint, error, required, htmlFor, children, className }: FieldShellProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="flex items-center gap-1 text-xs font-medium text-mist-300">
          {label}
          {required && <span className="text-bad-400">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-bad-400">{error}</p> : hint ? <p className="text-xs text-mist-500">{hint}</p> : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
}

export function Input({ label, hint, error, leftIcon, rightSlot, className, id, required, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <FieldShell label={label} hint={hint} error={error} required={required} htmlFor={inputId}>
      <div className="relative">
        {leftIcon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-500">{leftIcon}</span>}
        <input
          {...rest}
          id={inputId}
          required={required}
          className={cn(
            "h-10 w-full rounded-xl border border-white/10 bg-ink-900/80 px-3 text-sm text-mist-100 placeholder:text-mist-500",
            "outline-none transition-colors focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20",
            !!leftIcon && "pl-9",
            !!rightSlot && "pr-10",
            error && "border-bad-500/60 focus:border-bad-400",
            className,
          )}
        />
        {rightSlot && <span className="absolute right-2 top-1/2 -translate-y-1/2">{rightSlot}</span>}
      </div>
    </FieldShell>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
}

export function Textarea({ label, hint, error, className, id, ...rest }: TextareaProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={inputId}>
      <textarea
        {...rest}
        id={inputId}
        className={cn(
          "w-full resize-none rounded-xl border border-white/10 bg-ink-900/80 px-3 py-2.5 text-sm text-mist-100 placeholder:text-mist-500",
          "outline-none transition-colors focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20",
          error && "border-bad-500/60",
          className,
        )}
      />
    </FieldShell>
  );
}

export interface SelectChangeEvent {
  target: { value: string };
  currentTarget: { value: string };
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value"> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  options: { value: string; label: string; disabled?: boolean }[];
  value?: string;
  onChange?: (event: SelectChangeEvent) => void;
}

/** 自定义下拉选择（不使用浏览器原生 select），支持键盘操作与深色/浅色主题 */
export function Select({ label, hint, error, options, className, id, value, onChange, disabled, name }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>({
    left: 0,
    width: 0,
    maxHeight: 280,
  });

  const selectableIndexes = useMemo(
    () => options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0),
    [options],
  );
  const selectedIndex = options.findIndex((option) => option.value === (value ?? ""));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const updatePosition = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    setPosition({
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(280, Math.max(120, openUp ? spaceAbove : spaceBelow)),
      ...(openUp ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
    });
  };

  const openMenu = () => {
    if (disabled) return;
    updatePosition();
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : (selectableIndexes[0] ?? -1));
    setOpen(true);
  };

  const closeMenu = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const choose = (option: { value: string; label: string; disabled?: boolean }) => {
    if (option.disabled) return;
    onChange?.({ target: { value: option.value }, currentTarget: { value: option.value } });
    closeMenu();
  };

  const moveActive = (direction: 1 | -1 | "first" | "last") => {
    if (!options.length) return;
    const enabled = selectableIndexes;
    if (enabled.length === 0) return;
    if (direction === "first") {
      setActiveIndex(enabled[0] ?? -1);
      return;
    }
    if (direction === "last") {
      setActiveIndex(enabled[enabled.length - 1] ?? -1);
      return;
    }
    const current = enabled.indexOf(activeIndex);
    const next = current < 0 ? (direction === 1 ? 0 : enabled.length - 1) : (current + direction + enabled.length) % enabled.length;
    setActiveIndex(enabled[next] ?? -1);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex, options, selectedIndex]);

  return (
    <FieldShell label={label} hint={hint} error={error} htmlFor={selectId}>
      <button
        ref={buttonRef}
        id={selectId}
        name={name}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? selectId + "-listbox" : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? selectId + "-option-" + activeIndex : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
            else moveActive(event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Enter" || event.key === " ") {
            if (open && activeIndex >= 0) {
              event.preventDefault();
              const option = options[activeIndex];
              if (option) choose(option);
            }
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu();
          }
        }}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-900/80 px-3 text-left text-sm text-mist-100",
          "outline-none transition-colors focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-bad-500/60",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-mist-500")}>{selected?.label ?? "请选择"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-mist-400 transition-transform", open && "rotate-180")} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={selectId + "-listbox"}
            role="listbox"
            aria-label={typeof label === "string" ? label : "选项"}
            className="fixed z-[80] overflow-y-auto rounded-xl border border-white/10 bg-ink-850 p-1 shadow-2xl shadow-black/50 app-scroll animate-scale-in"
            style={{ left: position.left, width: position.width, top: position.top, bottom: position.bottom, maxHeight: position.maxHeight }}
          >
            {options.length === 0 && <p className="px-3 py-2 text-xs text-mist-500">暂无可选项</p>}
            {options.map((option, index) => {
              const active = index === activeIndex;
              const isSelected = option.value === (value ?? "");
              return (
                <button
                  key={option.value + "-" + index}
                  id={selectId + "-option-" + index}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    option.disabled && "cursor-not-allowed opacity-40",
                    active ? "bg-brand-500/15 text-mist-100" : "text-mist-200 hover:bg-white/5",
                    isSelected && "font-medium",
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && <Check className="h-4 w-4 shrink-0 text-brand-400" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </FieldShell>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  return (
    <label className={cn("flex cursor-pointer items-center justify-between gap-4", disabled && "cursor-not-allowed opacity-60")}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm text-mist-100">{label}</span>}
          {description && <span className="mt-0.5 block text-xs text-mist-500">{description}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-brand-500" : "bg-ink-600",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </label>
  );
}

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  label?: ReactNode;
  formatValue?: (value: number) => ReactNode;
  disabled?: boolean;
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, label, formatValue, disabled }: SliderProps) {
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      {(label || formatValue) && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-mist-300">{label}</span>
          <span className="font-mono text-mist-400">{formatValue ? formatValue(value) : value}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="airmic-range w-full disabled:cursor-not-allowed"
        style={{ "--range-progress": percent + "%" } as CSSProperties}
      />
    </div>
  );
}

// ============ Avatar ============

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const avatarSizes: Record<AvatarSize, string> = {
  xs: "h-7 w-7 text-[10px]",
  sm: "h-9 w-9 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-14 w-14 text-lg",
  xl: "h-20 w-20 text-2xl",
};

export interface AvatarProps {
  name: string;
  color?: string;
  emoji?: string | null;
  size?: AvatarSize;
  speaking?: boolean;
  muted?: boolean;
  deafened?: boolean;
  className?: string;
  ringClassName?: string;
}

export function Avatar({ name, color = "#6366f1", emoji, size = "md", speaking, muted, deafened, className }: AvatarProps) {
  return (
    <div className={cn("relative inline-flex shrink-0", className)}>
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl font-semibold text-white select-none transition-shadow",
          avatarSizes[size],
          speaking && "speaking-ring",
        )}
        style={{
          background: "linear-gradient(145deg, " + colorWithAlpha(color, 0.95) + ", " + colorWithAlpha(color, 0.55) + ")",
          border: "1px solid " + colorWithAlpha(color, 0.5),
        }}
      >
        {emoji ? <span>{emoji}</span> : <span>{initials(name)}</span>}
      </div>
      {(muted || deafened) && (
        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 ring-1 ring-white/15">
          {deafened ? <XCircle className="h-3.5 w-3.5 text-bad-400" /> : <MicOffMini />}
        </span>
      )}
    </div>
  );
}

function MicOffMini() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-bad-400" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
      <path d="M5 10v2a7 7 0 0 0 11 5.75M19 10v2a7 7 0 0 1-.34 2.12" />
      <path d="M12 19v3M8 22h8M3 3l18 18" />
    </svg>
  );
}

// ============ Misc ============

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "brand" | "good" | "warn" | "bad"; className?: string }) {
  const tones: Record<string, string> = {
    neutral: "bg-white/5 text-mist-300 ring-white/10",
    brand: "bg-brand-500/15 text-brand-300 ring-brand-400/30",
    good: "bg-good-500/10 text-good-400 ring-good-500/20",
    warn: "bg-warn-500/10 text-warn-400 ring-warn-500/20",
    bad: "bg-bad-500/10 text-bad-400 ring-bad-500/20",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-brand-400", className)} />;
}

export function FullScreenLoader({ text = "正在加载…" }: { text?: string }) {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-ink-950">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-brand-500/40 to-aqua-400/30 blur-xl" />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-800 ring-1 ring-white/10">
          <Spinner />
        </div>
      </div>
      <p className="text-sm text-mist-400">{text}</p>
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center", className)}>
      {icon && <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-800 text-mist-400">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-mist-200">{title}</p>
        {description && <p className="mt-1 text-xs text-mist-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: LucideIcon;
}

export function Tabs({ items, value, onChange, className }: { items: TabItem[]; value: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1 rounded-xl bg-ink-900/70 p-1 ring-1 ring-white/5", className)}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-ink-700 text-mist-100 shadow" : "text-mist-400 hover:text-mist-200",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-md border border-white/10 bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-mist-300">
      {children}
    </span>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-white/5", className)} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-mist-500">{children}</h3>
      {action}
    </div>
  );
}

// ============ Modal ============

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  hideClose?: boolean;
}

const modalSizes: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  "2xl": "max-w-4xl",
};

export function Modal({ open, onClose, title, subtitle, children, footer, size = "md", hideClose }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-850 shadow-2xl shadow-black/60 animate-scale-in",
          modalSizes[size],
        )}
        role="dialog"
        aria-modal="true"
      >
        {(title || !hideClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-white/5 px-5 py-4">
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold text-mist-100">{title}</h2>}
              {subtitle && <p className="mt-1 text-xs text-mist-400">{subtitle}</p>}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1 text-mist-400 transition-colors hover:bg-white/5 hover:text-mist-100"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto app-scroll px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-white/5 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ============ Toast & Confirm ============

const toastStyles: Record<ToastType, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: "text-brand-300" },
  success: { icon: CheckCircle2, className: "text-good-400" },
  error: { icon: XCircle, className: "text-bad-400" },
  warning: { icon: AlertTriangle, className: "text-warn-400" },
};

export function ToastHost() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(92vw,380px)] flex-col gap-2">
      {toasts.map((toast) => {
        const style = toastStyles[toast.type];
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-white/10 bg-ink-850/95 px-3.5 py-3 shadow-xl shadow-black/40 backdrop-blur animate-fade-in"
          >
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.className)} />
            <div className="min-w-0 flex-1">
              {toast.title && <p className="text-xs font-semibold text-mist-100">{toast.title}</p>}
              <p className="text-xs leading-relaxed text-mist-300">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="shrink-0 rounded p-0.5 text-mist-500 transition-colors hover:text-mist-200"
              aria-label="关闭提示"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export function ConfirmDialog() {
  const confirmState = useUiStore((state) => state.confirmState);
  const resolve = useUiStore((state) => state.resolveConfirm);
  return (
    <Modal
      open={confirmState !== null}
      onClose={() => resolve(false)}
      title={confirmState?.title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => resolve(false)}>
            {confirmState?.cancelText ?? "取消"}
          </Button>
          <Button variant={confirmState?.danger ? "danger" : "primary"} size="sm" onClick={() => resolve(true)}>
            {confirmState?.confirmText ?? "确定"}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-mist-300">{confirmState?.message}</p>
    </Modal>
  );
}