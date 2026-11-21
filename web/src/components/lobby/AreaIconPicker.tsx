import { useState } from "react";
import { AREA_SYMBOLS, GAME_LOGOS, type AreaIconId } from "@airmic/shared";
import { Search } from "lucide-react";
import { Input, Tabs } from "@/components/ui";
import { cn } from "@/lib/format";
import AreaIcon, { areaIconLabel, findGameLogo } from "./AreaIcon";

const tabs = [
  { id: "general", label: "通用图标" },
  { id: "games", label: "游戏 Logo" },
];

export default function AreaIconPicker({ value, isRoot, onChange }: {
  value: AreaIconId | null;
  isRoot: boolean;
  onChange: (icon: AreaIconId | null) => void;
}) {
  const [tab, setTab] = useState(() => (value ? !findGameLogo(value) : isRoot) ? "general" : "games");
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const options = tab === "general"
    ? [null, ...AREA_SYMBOLS]
    : GAME_LOGOS.filter((game) => `${game.label} ${game.search}`.toLowerCase().includes(query)).map((game) => game.id);

  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="text-sm font-medium text-foreground">{isRoot ? "频道图标" : "子区图标"}</legend>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <AreaIcon icon={value} isRoot={isRoot} className="h-6 w-6 shrink-0 text-brand" />
          <span className="truncate">{areaIconLabel(value)}</span>
        </div>
        {value && <button type="button" onClick={() => onChange(null)}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          恢复默认
        </button>}
      </div>
      <Tabs items={tabs} value={tab} onChange={setTab} />
      {tab === "games" && (
        <Input aria-label="搜索游戏" placeholder="搜索游戏名称或简称" value={search}
          leftIcon={<Search className="h-4 w-4" />} onChange={(event) => setSearch(event.target.value)} />
      )}
      {options.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {options.map((icon) => {
            const label = areaIconLabel(icon);
            const selected = value === icon;
            return (
              <button key={icon ?? "default"} type="button" title={label} aria-pressed={selected} onClick={() => onChange(icon)}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 py-2 text-xs focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? "border-primary/50 bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                )}>
                <AreaIcon icon={icon} isRoot={isRoot} className="h-7 w-7 shrink-0" />
                <span className="w-full truncate text-center">{label}</span>
              </button>
            );
          })}
        </div>
      ) : <p className="py-4 text-center text-xs text-muted-foreground">没有找到匹配的游戏</p>}
    </fieldset>
  );
}
