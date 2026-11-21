import { WS_MAX_MESSAGE_BYTES, type ClientMessage } from "@airmic/shared";
import { z } from "zod";

/** SDP 字符串最大长度（字符），与协议层单条消息上限保持一致 */
const MAX_SDP_CHARS = WS_MAX_MESSAGE_BYTES;

const iceCandidateSchema = z
  .object({
    candidate: z.string().max(8192, "ICE 候选地址过长").nullable(),
    sdpMid: z.string().max(256).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65535).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  })
  .strict();

const signalPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("offer"), sdp: z.string().min(1).max(MAX_SDP_CHARS) }).strict(),
  z.object({ kind: z.literal("answer"), sdp: z.string().min(1).max(MAX_SDP_CHARS) }).strict(),
  z.object({ kind: z.literal("candidate"), candidate: iceCandidateSchema }).strict(),
]);

const peerStatePatchSchema = z
  .object({
    muted: z.boolean().optional(),
    deafened: z.boolean().optional(),
    speaking: z.boolean().optional(),
    screenSharing: z.boolean().optional(),
  })
  .strict();

/** 客户端 -> 服务端消息校验；未知字段/未知类型统一按 bad_request 处理 */
export const clientMessageSchema = z.discriminatedUnion("t", [
  z
    .object({
      t: z.literal("join_room"),
      roomId: z.number().int().positive(),
      password: z.string().max(64).optional(),
    })
    .strict(),
  z.object({ t: z.literal("create_code_room"), name: z.string().trim().min(1).max(40) }).strict(),
  z.object({ t: z.literal("join_code_room"), code: z.string().regex(/^\d{4}$/), roomId: z.number().int().positive().safe().optional() }).strict(),
  z.object({ t: z.literal("leave_room") }).strict(),
  z.object({ t: z.literal("chat"), content: z.string().max(MAX_SDP_CHARS) }).strict(),
  z.object({ t: z.literal("state"), state: peerStatePatchSchema }).strict(),
  z
    .object({
      t: z.literal("signal"),
      to: z.number().int().positive(),
      payload: signalPayloadSchema,
    })
    .strict(),
  z.object({ t: z.literal("screen_share"), active: z.boolean() }).strict(),
  z.object({ t: z.literal("ping"), ts: z.number().finite().optional() }).strict(),
  z.object({ t: z.literal("request_rooms") }).strict(),
  z.object({ t: z.literal("request_online_users") }).strict(),
]);

export type ParsedClientMessage = z.infer<typeof clientMessageSchema>;
export type ParsedSignalPayload = z.infer<typeof signalPayloadSchema>;
export type ParsedPeerStatePatch = z.infer<typeof peerStatePatchSchema>;

const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set<ClientMessage["t"]>([
  "join_room",
  "create_code_room",
  "join_code_room",
  "leave_room",
  "chat",
  "state",
  "signal",
  "screen_share",
  "ping",
  "request_rooms",
  "request_online_users",
]);

/** 尽力从原始消息中提取类型，便于在错误响应里回填 request 字段 */
export function extractClientMessageType(raw: unknown): ClientMessage["t"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const type = (raw as { t?: unknown }).t;
  if (typeof type !== "string" || !CLIENT_MESSAGE_TYPES.has(type)) return undefined;
  return type as ClientMessage["t"];
}

/** 解析客户端消息；非法消息返回 null（由调用方回复 bad_request） */
export function parseClientMessage(raw: unknown): ParsedClientMessage | null {
  const result = clientMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}
