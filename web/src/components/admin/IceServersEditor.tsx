import type { IceServerConfig } from "@airmic/shared";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton, Input } from "@/components/ui";

export interface IceDraft {
  id: number;
  urls: string;
  username: string;
  credential: string;
}

let nextIceId = 1;

export function iceRowsFrom(configs: IceServerConfig[]): IceDraft[] {
  return configs.map((config) => ({
    id: nextIceId++,
    urls: Array.isArray(config.urls) ? config.urls.join(", ") : config.urls,
    username: config.username ?? "",
    credential: config.credential ?? "",
  }));
}

export function iceRowsToConfigs(rows: IceDraft[]): IceServerConfig[] {
  const configs: IceServerConfig[] = [];
  for (const row of rows) {
    const urls = row.urls
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (urls.length === 0) continue;
    const config: IceServerConfig = { urls: urls.length === 1 ? urls[0] : urls };
    if (row.username.trim()) config.username = row.username.trim();
    if (row.credential.trim()) config.credential = row.credential.trim();
    configs.push(config);
  }
  return configs;
}

export interface IceServersEditorProps {
  value: IceDraft[];
  onChange: (rows: IceDraft[]) => void;
}

export default function IceServersEditor({ value, onChange }: IceServersEditorProps) {
  const addRow = () => onChange([...value, { id: nextIceId++, urls: "", username: "", credential: "" }]);
  const updateRow = (id: number, patch: Partial<IceDraft>) => onChange(value.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const removeRow = (id: number) => onChange(value.filter((row) => row.id !== id));

  return (
    <div className="space-y-2.5">
      {value.length === 0 && (
        <p className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-center text-xs text-mist-500">
          还没有配置 ICE 服务器，公网连接需要至少一个 STUN 或 TURN 服务
        </p>
      )}
      {value.map((row, index) => (
        <div key={row.id} className="space-y-2 rounded-xl border border-white/10 bg-ink-900/40 p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={"地址 #" + (index + 1)}
                value={row.urls}
                placeholder="stun:stun.l.google.com:19302 或 turn:turn.example.com:3478"
                hint="多个地址用空格或逗号分隔；TURN 需填写用户名/密码"
                onChange={(event) => updateRow(row.id, { urls: event.target.value })}
              />
            </div>
            <IconButton label="删除该 ICE 服务器" variant="danger" onClick={() => removeRow(row.id)}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input label="用户名（可选）" value={row.username} maxLength={200} placeholder="TURN 用户名" onChange={(event) => updateRow(row.id, { username: event.target.value })} />
            <Input label="密码/凭据（可选）" value={row.credential} maxLength={300} placeholder="TURN 密码" onChange={(event) => updateRow(row.id, { credential: event.target.value })} />
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={addRow} disabled={value.length >= 20}>
        添加 ICE 服务器
      </Button>
    </div>
  );
}
