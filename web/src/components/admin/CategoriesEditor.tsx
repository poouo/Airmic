import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, Input } from "@/components/ui";

export interface CategoriesEditorProps {
  value: string[];
  onChange: (categories: string[]) => void;
}

export default function CategoriesEditor({ value, onChange }: CategoriesEditorProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError("请输入分类名称");
      return;
    }
    if (Array.from(trimmed).length > 20) {
      setError("分类名称最多 20 个字符");
      return;
    }
    if (value.includes(trimmed)) {
      setError("该分类已存在");
      return;
    }
    if (value.length >= 20) {
      setError("最多 20 个房间分类");
      return;
    }
    onChange([...value, trimmed]);
    setInput("");
    setError(null);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-xs text-mist-500">还没有分类，至少添加一个</span>}
        {value.map((category) => (
          <span key={category} className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs text-mist-200 ring-1 ring-white/10">
            {category}
            <button
              type="button"
              onClick={() => onChange(value.filter((item) => item !== category))}
              className="rounded p-0.5 text-mist-500 transition-colors hover:bg-white/10 hover:text-bad-400"
              aria-label={"删除分类 " + category}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div className="max-w-xs flex-1">
          <Input
            label="新增分类"
            value={input}
            maxLength={20}
            error={error}
            placeholder="例如：排位房"
            onChange={(event) => {
              setInput(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
        </div>
        <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={add}>
          添加
        </Button>
      </div>
      <p className="text-[11px] text-mist-500">大厅与房间表单会按分类分组展示房间；最多 20 个分类，顺序即展示顺序。</p>
    </div>
  );
}
