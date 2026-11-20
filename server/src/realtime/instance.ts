import type { HubLike } from "./contracts.js";

let hub: HubLike | null = null;

export function setHub(next: HubLike | null): void {
  hub = next;
}

/** REST 路由通过该函数访问实时层；未启动实时层时返回 null */
export function getHub(): HubLike | null {
  return hub;
}
