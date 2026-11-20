import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({ config });

const scheme = config.ssl ? "https" : "http";
const displayHost = config.host === "0.0.0.0" || config.host === "::" ? "localhost" : config.host;

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

console.log("");
console.log("  █████  ██ ██████  ███    ███ ██  ██████");
console.log("  ██  ██ ██ ██   ██ ████  ████ ██ ██     ");
console.log("  ███████ ██ ██████  ██ ████ ██ ██ ██     ");
console.log("  ██   ██ ██ ██   ██ ██  ██  ██ ██ ██     ");
console.log("  ██   ██ ██ ██   ██ ██      ██ ██  ██████");
console.log("");
console.log("  AirMic 已启动  " + scheme + "://" + displayHost + ":" + config.port);
console.log("  数据库: " + config.databasePath);
if (!config.ssl && config.host !== "127.0.0.1" && config.host !== "localhost") {
  console.log("  ⚠ 浏览器只在 HTTPS 或 localhost 下允许使用麦克风。局域网/公网使用请配置 SSL_CERT/SSL_KEY 或反向代理。");
}
console.log("");

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info("收到 " + signal + "，正在关闭...");
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
