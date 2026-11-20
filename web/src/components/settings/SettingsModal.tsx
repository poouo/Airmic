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
      subtitle="设备、音量与音质偏好保存在本机，修改立即生效"
      size="xl"
      footer={
        <>
          <span className="mr-auto hidden text-xs text-muted-foreground sm:block">设置会自动保存</span>
          <Button variant="secondary" onClick={closeModal}>
            完成
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
        <nav aria-label="设置分类" className="flex shrink-0 gap-1 overflow-x-auto no-scrollbar sm:w-40 sm:flex-col">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-pressed={active}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  "sm:w-full",
                  active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {Icon && <Icon className="h-4 w-4 shrink-0" />}
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1 sm:border-l sm:border-border sm:pl-5">
          <div className="max-h-[56vh] overflow-y-auto app-scroll pr-1">
            {tab === "microphone" && <MicrophoneTab />}
            {tab === "speaker" && <SpeakerTab />}
            {tab === "network" && <NetworkTab />}
            {tab === "other" && <OtherTab />}
          </div>
        </div>
      </div>
    </Modal>
  );
}
