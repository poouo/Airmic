export const AREA_SYMBOLS = ["gamepad", "headphones", "mic", "music", "users", "sparkles", "trophy", "shield",
  "target", "star", "flame", "car"] as const;

export const GAME_LOGOS = [
  { id: "delta-force", label: "三角洲行动", search: "三角洲 Delta Force" },
  { id: "league-of-legends", label: "英雄联盟", search: "LOL League of Legends" },
  { id: "valorant", label: "无畏契约", search: "瓦 VALORANT" },
  { id: "counter-strike-2", label: "反恐精英 2", search: "CS2 CSGO Counter-Strike" },
  { id: "pubg", label: "绝地求生", search: "PUBG Battlegrounds 吃鸡" },
  { id: "apex-legends", label: "Apex 英雄", search: "Apex Legends" },
  { id: "honor-of-kings", label: "王者荣耀", search: "Honor of Kings HOK" },
  { id: "teamfight-tactics", label: "云顶之弈", search: "TFT Teamfight Tactics" },
  { id: "dota-2", label: "Dota 2", search: "刀塔 2 DOTA2" },
  { id: "overwatch-2", label: "守望先锋", search: "守望先锋 2 Overwatch OW" },
  { id: "marvel-rivals", label: "漫威争锋", search: "Marvel Rivals" },
  { id: "naraka", label: "永劫无间", search: "Naraka Bladepoint" },
  { id: "genshin-impact", label: "原神", search: "Genshin Impact" },
  { id: "minecraft", label: "我的世界", search: "Minecraft MC" },
  { id: "gta-v", label: "GTA V", search: "侠盗猎车手 GTA5 GTA Online Grand Theft Auto V" },
  { id: "rainbow-six-siege", label: "彩虹六号", search: "Rainbow Six Siege 围攻 R6" },
  { id: "call-of-duty", label: "使命召唤", search: "Call of Duty COD 战区 Warzone" },
  { id: "battlefield-6", label: "战地 6", search: "Battlefield 6 BF6" },
  { id: "the-finals", label: "最终决战", search: "THE FINALS" },
  { id: "black-myth-wukong", label: "黑神话 悟空", search: "Black Myth Wukong" },
  { id: "elden-ring", label: "艾尔登法环", search: "Elden Ring 老头环" },
  { id: "monster-hunter-wilds", label: "怪物猎人 荒野", search: "Monster Hunter Wilds 怪猎" },
  { id: "helldivers-2", label: "绝地潜兵 2", search: "Helldivers 2" },
  { id: "destiny-2", label: "命运 2", search: "Destiny 2" },
  { id: "warframe", label: "星际战甲", search: "Warframe" },
  { id: "left-4-dead-2", label: "求生之路 2", search: "Left 4 Dead 2 L4D2" },
  { id: "dead-by-daylight", label: "黎明杀机", search: "Dead by Daylight DBD" },
  { id: "lethal-company", label: "致命公司", search: "Lethal Company" },
  { id: "rust", label: "腐蚀", search: "Rust" },
  { id: "palworld", label: "幻兽帕鲁", search: "Palworld" },
  { id: "terraria", label: "泰拉瑞亚", search: "Terraria" },
  { id: "stardew-valley", label: "星露谷物语", search: "Stardew Valley" },
] as const;

export type AreaIconId = (typeof AREA_SYMBOLS)[number] | (typeof GAME_LOGOS)[number]["id"];

const areaIconIds = new Set<string>([...AREA_SYMBOLS, ...GAME_LOGOS.map((game) => game.id)]);

export function isAreaIconId(value: string): value is AreaIconId {
  return areaIconIds.has(value);
}
