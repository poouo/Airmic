import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Alert, Button, Modal } from "@/components/ui";

export default function RoomCodeShareModal({ roomName, code, onClose }: {
  roomName: string;
  code: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <Modal open title="房间口令" subtitle={roomName} onClose={onClose} size="sm" footer={<>
      <Button variant="outline" size="sm" onClick={onClose}>完成</Button>
      <Button size="sm" onClick={() => void copyCode()} icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}>
        {copied ? "已复制" : "复制口令"}
      </Button>
    </>}>
      <div className="space-y-3">
        <div aria-label={`四位口令 ${code}`} role="group"
          className="grid select-all grid-cols-4 gap-2 rounded-2xl border border-primary/15 bg-linear-to-br from-primary/12 to-accent/60 p-3 sm:gap-3 sm:p-4">
          {Array.from(code).map((digit, index) => (
            <span key={index} aria-hidden="true" className="grid aspect-square place-items-center rounded-xl border border-border bg-card font-mono text-3xl font-semibold text-foreground shadow-sm">
              {digit}
            </span>
          ))}
        </div>
        <p className="text-center text-xs leading-relaxed text-muted-foreground">队友可在大厅输入口令加入。房间清空后口令失效。</p>
        {copyFailed && <Alert tone="info">选中四位数字即可手动复制。</Alert>}
      </div>
    </Modal>
  );
}
