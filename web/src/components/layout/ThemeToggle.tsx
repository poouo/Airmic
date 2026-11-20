import { Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui";
import { useThemeStore } from "@/stores/theme";

/** 白天/夜间模式切换（默认白天） */
export default function ThemeToggle({ className }: { className?: string }) {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const dark = theme === "dark";
  return (
    <IconButton
      label={dark ? "切换到白天模式" : "切换到夜间模式"}
      title={dark ? "切换到白天模式" : "切换到夜间模式"}
      className={className}
      onClick={toggleTheme}
      data-testid="theme-toggle"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </IconButton>
  );
}
