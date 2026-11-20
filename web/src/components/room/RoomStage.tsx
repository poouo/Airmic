import { useEffect, useRef, type CSSProperties } from "react";
import { MonitorUp, Share2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import type { PeerNetworkStats } from "@/voice/engine";
import { MemberCard } from "./MemberCard";
import type { RoomMember } from "./types";

export interface RoomStageProps {
  members: RoomMember[];
  screenSharer: RoomMember | null;
  screenStream: MediaStream | null;
  selfScreenStream: MediaStream | null;
  peerStats: Record<number, PeerNetworkStats>;
  volumes: Record<string, number>;
  onVolumeChange: (userId: number, volume: number) => void;
  onLocalMute: (userId: number, muted: boolean) => void;
  onStopScreenShare: () => void;
}

/** 房间舞台：成员网格；有人共享屏幕时切换为大画面 + 成员条 */
export function RoomStage({
  members,
  screenSharer,
  screenStream,
  selfScreenStream,
  peerStats,
  volumes,
  onVolumeChange,
  onLocalMute,
  onStopScreenShare,
}: RoomStageProps) {
  if (screenSharer) {
    const stream = screenSharer.isSelf ? selfScreenStream : screenStream;
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="relative min-h-[240px] flex-1 overflow-hidden rounded-2xl border border-border bg-black shadow-card">
          <ScreenVideo stream={stream} />
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-foreground/75 px-3 py-1.5 text-xs text-background">
            <MonitorUp className="h-3.5 w-3.5" />
            <span className="max-w-[16rem] truncate">
              {screenSharer.isSelf ? "你" : screenSharer.displayName} 正在共享屏幕
            </span>
          </div>
          {screenSharer.isSelf && (
            <div className="absolute right-3 top-3">
              <Button size="sm" variant="danger" onClick={onStopScreenShare} icon={<MonitorUp className="h-3.5 w-3.5" />}>
                停止共享
              </Button>
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2 overflow-x-auto pb-1 app-scroll">
          {members.map((member) => (
            <div key={member.userId} className="w-36 shrink-0 sm:w-40">
              <MemberCard
                member={member}
                stats={peerStats[member.userId]}
                volume={volumes[String(member.userId)] ?? 100}
                onVolumeChange={onVolumeChange}
                onLocalMute={onLocalMute}
                compact
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const count = members.length;
  // 大房间自动缩小卡片并增加列数；网格本身位于 RoomPage 的滚动容器内
  const tileWidth = count > 30 ? 112 : count > 18 ? 132 : count > 10 ? 152 : count > 4 ? 176 : 200;
  const gridStyle: CSSProperties = {
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, " + tileWidth + "px), 1fr))",
  };
  const compactTiles = count > 12;

  return (
    <div className={cn("mx-auto w-full space-y-4", count <= 2 ? "max-w-md" : "max-w-none")}>
      <div className="grid content-start gap-2 sm:gap-3" style={gridStyle}>
        {members.map((member) => (
          <MemberCard
            key={member.userId}
            member={member}
            stats={peerStats[member.userId]}
            volume={volumes[String(member.userId)] ?? 100}
            onVolumeChange={onVolumeChange}
            onLocalMute={onLocalMute}
            compact={compactTiles}
          />
        ))}
      </div>
      {count <= 1 && <InviteHint />}
    </div>
  );
}

function InviteHint() {
  const copyLink = () => {
    const text = window.location.href;
    const clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === "function") {
      void clipboard
        .writeText(text)
        .then(() => useUiStore.getState().toast("房间链接已复制，发给队友即可加入", "success"))
        .catch(() => useUiStore.getState().toast("复制失败，请手动复制地址栏链接", "warning"));
      return;
    }
    useUiStore.getState().toast("请手动复制地址栏链接分享给队友", "info");
  };

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <UserPlus className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">房间里只有你</p>
        <p className="mt-1 text-xs text-muted-foreground">把房间链接分享给队友，等他们加入后会自动连接语音</p>
      </div>
      <Button size="sm" variant="secondary" icon={<Share2 className="h-3.5 w-3.5" />} onClick={copyLink}>
        复制房间链接
      </Button>
    </div>
  );
}

function ScreenVideo({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = stream;
    if (stream) void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  if (!stream) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        正在等待屏幕画面…
      </div>
    );
  }
  return <video ref={videoRef} autoPlay playsInline muted className="h-full w-full bg-black object-contain" />;
}
