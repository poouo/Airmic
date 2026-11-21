import type { ServerSettingsPublic } from "@airmic/shared";
import AirMicMark from "@/components/brand/AirMicMark";

export default function AuthBrandPanel({ server }: { server: ServerSettingsPublic | null }) {
  return (
    <aside className="hidden min-w-0 flex-col justify-center gap-5 bg-linear-to-br from-secondary via-card to-accent p-10 lg:flex">
      <AirMicMark size={64} className="rounded-[26%] shadow-raised" />
      <div className="space-y-3">
        <h2 className="break-words text-3xl font-semibold tracking-tight">{server?.name ?? "AirMic"}</h2>
        {server?.motd && <p className="whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground">{server.motd}</p>}
      </div>
    </aside>
  );
}
