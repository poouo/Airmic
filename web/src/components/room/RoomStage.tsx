import { useEffect, useRef } from "react";
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
        <div className="relative min-h-[240px] flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black">
          <ScreenVideo stream={stream} />
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-ink-950/75 px-3 py-1.5 text-xs text-mist-200 ring-1 ring-white/10 backdrop-blur">
            <MonitorUp className="h-3.5 w-3.5 text-aqua-400" />
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
            <MemberCard
              key={member.userId}
              member={member}
              stats={peerStats[member.userId]}
              volume={volumes[String(member.userId)] ?? 100}
              onVolumeChange={onVolumeChange}
              onLocalMute={onLocalMute}
              compact
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className={cn("grid gap-3 sm:gap-4", gridClassFor(members.length))}>
        {members.map((member) => (
          <MemberCard
            key={member.userId}
            member={member}
            stats={peerStats[member.userId]}
            volume={volumes[String(member.userId)] ?? 100}
            onVolumeChange={onVolumeChange}
            onLocalMute={onLocalMute}
          />
        ))}
      </div>
      {members.length <= 1 && <InviteHint />}
    </div>
  );
}

function gridClassFor(count: number): string {
  if (count <= 1) return "grid-cols-1 max-w-xs";
  if (count <= 2) return "grid-cols-1 max-w-md sm:grid-cols-2 sm:max-w-xl";
  if (count <= 4) return "grid-cols-2";
  if (count <= 6) return "grid-cols-2 sm:grid-cols-3";
  if (count <= 9) return "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5";
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
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-ink-900/40 px-4 py-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-800 text-mist-400">
        <UserPlus className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm text-mist-200">房间里只有你</p>
        <p className="mt-1 text-xs text-mist-500">把房间链接分享给队友，等他们加入后会自动连接语音</p>
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
      <div className="flex h-full w-full items-center justify-center text-sm text-mist-500">
        正在等待屏幕画面…
      </div>
    );
  }
  return <video ref={videoRef} autoPlay playsInline muted className="h-full w-full bg-black object-contain" />;
}
