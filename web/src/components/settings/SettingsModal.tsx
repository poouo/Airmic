import { useState } from "react";
import { Mic, SlidersHorizontal, Volume2, Wifi } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import type { TabItem } from "@/components/ui";
import { cn } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import { MicrophoneTab } from "./MicrophoneTab";
import { NetworkTab } from "./NetworkTab";
import { OtherTab } from "./OtherTab";
import { SpeakerTab } from "./SpeakerTab";

const TABS: TabItem[] = [
  { id: "microphone", label: "麦克风", icon: Mic },
  { id: "speaker", label: "扬声器", icon: Volume2 },
  { id: "network", label: "网络", icon: Wifi },
  { id: "other", label: "其他", icon: SlidersHorizontal },
];

/** 语音/设备设置弹窗（由 App 全局挂载） */
export default function SettingsModal() {
  const modal = useUiStore((state) => state.modal);
  const closeModal = useUiStore((state) => state.closeModal);
  const [tab, setTab] = useState("microphone");

  return (
    <Modal
      open={modal === "settings"}
      onClose={closeModal}
      title="语音设置"
      size="xl"
      footer={
        <>
          <span className="mr-auto text-xs text-muted-foreground">自动保存</span>
          <Button variant="secondary" onClick={closeModal}>
            完成
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <nav aria-label="设置分类" className="sticky top-0 z-10 grid grid-cols-4 gap-0.5 rounded-xl border border-border bg-card p-1 shadow-card sm:gap-1">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                onClick={(event) => {
                  setTab(item.id);
                  event.currentTarget.closest("[data-dialog-body]")?.scrollTo({ top: 0 });
                }}
                aria-pressed={active}
                className={cn(
                  "flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:text-sm",
                  active ? "bg-accent font-semibold text-brand" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {Icon && <Icon className="hidden h-4 w-4 shrink-0 sm:block" />}
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
            {tab === "microphone" && <MicrophoneTab />}
            {tab === "speaker" && <SpeakerTab />}
            {tab === "network" && <NetworkTab />}
            {tab === "other" && <OtherTab />}
        </div>
      </div>
    </Modal>
  );
}
