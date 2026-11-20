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

/* =========================================================================
   AirMic UI 基础组件
   视觉语言参考 ForwardX：中性浅色底、白色卡片、细边框、近黑主按钮。
   所有颜色走语义令牌，组件内禁止出现 ink/mist/brand 之类的旧色板类名。
   ========================================================================= */

// ============ Button ============

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex select-none items-center justify-center whitespace-nowrap font-medium " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 " +
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 " +
  "[&_svg]:shrink-0 active:translate-y-px";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/88",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
  ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
  danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  success: "bg-success text-white hover:bg-success/90",
  outline: "border border-border bg-card text-foreground hover:bg-accent",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-xs",
  md: "h-9 gap-2 rounded-field px-3.5 text-sm",
  lg: "h-10 gap-2 rounded-field px-5 text-sm",
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
  type,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type ?? "button"}
      disabled={disabled || loading}
      className={cn(buttonBase, buttonVariants[variant], buttonSizes[size], fullWidth && "w-full", className)}
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

export function IconButton({ label, size = "md", variant = "ghost", active, className, children, type, ...rest }: IconButtonProps) {
  const sizeClass = size === "sm" ? "h-8 w-8 rounded-md" : size === "lg" ? "h-10 w-10 rounded-field" : "h-9 w-9 rounded-field";
  return (
    <button
      {...rest}
      type={type ?? "button"}
      title={rest.title ?? label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center justify-center outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-40",
        variant === "ghost" && "text-muted-foreground hover:bg-accent hover:text-foreground",
        variant === "solid" && "border border-border bg-card text-foreground hover:bg-accent",
        variant === "danger" && "text-destructive hover:bg-destructive/10",
        active && "bg-accent text-foreground",
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
        <label htmlFor={htmlFor} className="flex items-center gap-1 text-xs font-medium text-foreground/80">
          {label}
          {required && <span className="text-destructive">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs leading-relaxed text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const fieldBase =
  "w-full rounded-field border border-input bg-card text-sm text-foreground shadow-card/0 " +
  "outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 " +
  "focus:border-ring focus:ring-2 focus:ring-ring/15 disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-70";

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
        {leftIcon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
            {leftIcon}
          </span>
        )}
        <input
          {...rest}
          id={inputId}
          required={required}
          className={cn(fieldBase, "h-9 px-3", !!leftIcon && "pl-9", !!rightSlot && "pr-10", error && "border-destructive focus:border-destructive focus:ring-destructive/15", className)}
        />
        {rightSlot && <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{rightSlot}</span>}
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
        className={cn(fieldBase, "min-h-[76px] resize-y px-3 py-2", error && "border-destructive focus:border-destructive", className)}
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

/** 自定义下拉选择（不使用浏览器原生 select），浮层跟随触发器定位 */
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
    maxHeight: 288,
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
      maxHeight: Math.min(288, Math.max(120, openUp ? spaceAbove : spaceBelow)),
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
    if (selectableIndexes.length === 0) return;
    if (direction === "first") {
      setActiveIndex(selectableIndexes[0] ?? -1);
      return;
    }
    if (direction === "last") {
      setActiveIndex(selectableIndexes[selectableIndexes.length - 1] ?? -1);
      return;
    }
    const current = selectableIndexes.indexOf(activeIndex);
    const next = current < 0 ? (direction === 1 ? 0 : selectableIndexes.length - 1) : (current + direction + selectableIndexes.length) % selectableIndexes.length;
    setActiveIndex(selectableIndexes[next] ?? -1);
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
          "flex h-9 w-full items-center justify-between gap-2 rounded-field border border-input bg-card px-3 text-left text-sm text-foreground",
          "outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-2 focus:ring-ring/15",
          "disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-70",
          error && "border-destructive",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground/70")}>{selected?.label ?? "请选择"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={selectId + "-listbox"}
            role="listbox"
            aria-label={typeof label === "string" ? label : "选项"}
            className="fixed z-[80] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-popover app-scroll animate-scale-in"
            style={{ left: position.left, width: position.width, top: position.top, bottom: position.bottom, maxHeight: position.maxHeight }}
          >
            {options.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">暂无可选项</p>}
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
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                    option.disabled && "cursor-not-allowed opacity-40",
                    active ? "bg-accent text-accent-foreground" : "text-foreground/90",
                    isSelected && "font-medium",
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
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
          {label && <span className="block text-sm font-medium text-foreground">{label}</span>}
          {description && <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{description}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left] duration-150",
            checked ? "left-[18px]" : "left-0.5",
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
          <span className="text-foreground/80">{label}</span>
          <span className="tabular font-medium text-muted-foreground">{formatValue ? formatValue(value) : value}</span>
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
  xs: "h-6 w-6 text-[10px] rounded-md",
  sm: "h-8 w-8 text-[11px] rounded-lg",
  md: "h-10 w-10 text-sm rounded-xl",
  lg: "h-12 w-12 text-base rounded-xl",
  xl: "h-16 w-16 text-xl rounded-2xl",
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
          "flex select-none items-center justify-center font-semibold transition-shadow",
          avatarSizes[size],
          speaking && "speaking-ring",
        )}
        style={{
          background: colorWithAlpha(color, 0.12),
          border: "1px solid " + colorWithAlpha(color, 0.22),
          color,
        }}
      >
        {emoji ? <span>{emoji}</span> : <span>{initials(name)}</span>}
      </div>
      {(muted || deafened) && (
        <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card">
          {deafened ? <XCircle className="h-3 w-3 text-destructive" /> : <MicOffMini />}
        </span>
      )}
    </div>
  );
}

function MicOffMini() {
  return <XCircle className="h-3 w-3 text-destructive" />;
}

// ============ 布局 / 容器 ============

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-border bg-card shadow-card", className)}>{children}</div>;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
        {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center justify-end gap-2 rounded-b-2xl border-t border-border bg-muted/40 px-5 py-3", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  badge,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {badge}
        </div>
        {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground/80 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
      </div>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "error";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const styles: Record<string, { wrap: string; icon: LucideIcon }> = {
    info: { wrap: "border-border bg-muted/50 text-foreground", icon: Info },
    success: { wrap: "border-success/25 bg-success/10 text-success", icon: CheckCircle2 },
    warning: { wrap: "border-warning/30 bg-warning/10 text-warning", icon: AlertTriangle },
    error: { wrap: "border-destructive/25 bg-destructive/10 text-destructive", icon: XCircle },
  };
  const style = styles[tone] ?? styles.info;
  const Icon = style.icon;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm", style.wrap, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 leading-relaxed">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(!!title && "mt-0.5 opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}

// ============ Misc ============

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "brand" | "good" | "warn" | "bad"; className?: string }) {
  const tones: Record<string, string> = {
    neutral: "bg-muted text-muted-foreground",
    brand: "bg-brand/10 text-brand",
    good: "bg-success/10 text-success",
    warn: "bg-warning/12 text-warning",
    bad: "bg-destructive/10 text-destructive",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium leading-5", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-muted-foreground", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function FullScreenLoader({ text = "正在加载…" }: { text?: string }) {
  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/50 px-6 py-10 text-center", className)}>
      {icon && <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>}
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
    <div className={cn("flex items-center gap-1 overflow-x-auto rounded-xl bg-muted/70 p-1 no-scrollbar", className)}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            aria-pressed={active}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
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
    <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-border", className)} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{children}</h3>
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
      <div className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px] animate-fade-in dark:bg-black/50" onClick={onClose} />
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-popover animate-scale-in",
          modalSizes[size],
        )}
        role="dialog"
        aria-modal="true"
      >
        {(title || !hideClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>}
              {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                className="-mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        <div className="max-h-[70vh] overflow-y-auto app-scroll px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ============ Toast & Confirm ============

const toastStyles: Record<ToastType, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: "text-info" },
  success: { icon: CheckCircle2, className: "text-success" },
  error: { icon: XCircle, className: "text-destructive" },
  warning: { icon: AlertTriangle, className: "text-warning" },
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
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-popover px-3.5 py-3 text-popover-foreground shadow-popover animate-rise-in"
          >
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.className)} />
            <div className="min-w-0 flex-1">
              {toast.title && <p className="text-sm font-medium text-foreground">{toast.title}</p>}
              <p className="text-xs leading-relaxed text-muted-foreground">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
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
          <Button variant="outline" size="sm" onClick={() => resolve(false)}>
            {confirmState?.cancelText ?? "取消"}
          </Button>
          <Button variant={confirmState?.danger ? "danger" : "primary"} size="sm" onClick={() => resolve(true)}>
            {confirmState?.confirmText ?? "确定"}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted-foreground">{confirmState?.message}</p>
    </Modal>
  );
}
