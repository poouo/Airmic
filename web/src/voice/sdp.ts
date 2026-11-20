/**
 * 兼容旧导入路径：麦克风错误提示已迁移到 ./livekit。
 * 新的 SFU 语音引擎不使用 SDP 手工修饰，此文件仅做 re-export。
 */
export { describeMicrophoneError } from "./livekit";
