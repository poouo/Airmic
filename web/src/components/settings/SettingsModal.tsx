import { useState } from "react";
import { Mic, SlidersHorizontal, Volume2, Wifi } from "lucide-react";
import { Button, Modal, Tabs } from "@/components/ui";
import type { TabItem } from "@/components/ui";
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
          <span className="mr-auto hidden text-[11px] text-mist-500 sm:block">设置会自动保存</span>
          <Button variant="secondary" onClick={closeModal}>
            完成
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Tabs items={TABS} value={tab} onChange={setTab} />
        {tab === "microphone" && <MicrophoneTab />}
        {tab === "speaker" && <SpeakerTab />}
        {tab === "network" && <NetworkTab />}
        {tab === "other" && <OtherTab />}
      </div>
    </Modal>
  );
}
