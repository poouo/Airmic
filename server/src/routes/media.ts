import type { FastifyInstance, FastifyRequest } from "fastify";
import { AccessToken } from "livekit-server-sdk";
import { LIVEKIT_TOKEN_TTL_SECONDS, livekitRoomName, type LivekitTokenResponse } from "@airmic/shared";
import { badRequest, forbidden, internalError, notFound, tooManyRequests } from "../lib/errors.js";
import { globalRateLimiter } from "../lib/rate-limit.js";
import { requireAuth } from "../plugins/auth.js";
import { getHub } from "../realtime/instance.js";
import type { Services } from "../types.js";

/** 每个用户每分钟最多换取令牌的次数 */
const TOKEN_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const;

interface RoomParams {
  id: string;
}

/**
 * LiveKit SFU 令牌接口。
 * 媒体流经服务器端 LiveKit 中转（不做客户端 P2P），
 * 客户端先通过 /ws 加入房间，再到这里换取加入同名 LiveKit 房间的访问令牌。
 */
export async function registerMediaRoutes(app: FastifyInstance, services: Services): Promise<void> {
  app.post("/api/rooms/:id/livekit-token", async (request: FastifyRequest): Promise<LivekitTokenResponse> => {
    const auth = requireAuth(request);
    if (!globalRateLimiter.hit("livekit-token:" + auth.user.id, TOKEN_RATE_LIMIT.limit, TOKEN_RATE_LIMIT.windowMs)) {
      throw tooManyRequests("获取语音令牌过于频繁，请稍后再试");
    }

    const credentials = services.settings.getLivekitCredentials();
    // 未配置（或配置不完整）时明确提示管理员配置语音中转服务；同时完成类型收窄
    if (!services.settings.isVoiceAvailable() || !credentials.url || !credentials.apiKey || !credentials.apiSecret) {
      throw badRequest(
        "语音中转服务未配置，请管理员在后台或环境变量中配置 LiveKit",
        "voice_not_configured",
      );
    }
    const { url, apiKey, apiSecret } = credentials;

    const rawRoomId = (request.params as RoomParams).id;
    const roomId = Number(rawRoomId);
    if (!Number.isInteger(roomId) || roomId <= 0) throw badRequest("房间 ID 不正确");
    if (!services.rooms.findById(roomId)) throw notFound("房间不存在");

    // 只有已经通过 WebSocket 加入该房间的用户才能换取语音令牌
    const currentRoomId = getHub()?.getRoomIdForUser(auth.user.id) ?? null;
    if (currentRoomId !== roomId) throw forbidden("请先加入房间");

    const room = livekitRoomName(roomId);
    const identity = String(auth.user.id);
    const canPublish = getHub()?.canPublishInRoom(auth.user.id, roomId) ?? true;
    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity,
      name: auth.user.displayName,
      metadata: JSON.stringify({
        userId: auth.user.id,
        role: auth.user.role,
        avatarColor: auth.user.avatarColor,
        avatarEmoji: auth.user.avatarEmoji,
        isGuest: auth.user.isGuest,
      }),
      ttl: LIVEKIT_TOKEN_TTL_SECONDS,
    });
    accessToken.addGrant({
      roomJoin: true,
      room,
      canPublish,
      canSubscribe: true,
      canPublishData: false,
    });

    let token: string;
    try {
      token = await accessToken.toJwt();
    } catch (error) {
      request.log.error({ err: error }, "生成 LiveKit 访问令牌失败");
      throw internalError("生成语音令牌失败，请稍后再试");
    }

    return { url, token, room, identity };
  });
}
