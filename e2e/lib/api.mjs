/** 带 Cookie 的轻量 API 客户端（用于 E2E 准备数据） */
export class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => name + "=" + value).join("; ");
  }

  absorb(response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        if (!value || raw.toLowerCase().includes("max-age=0")) this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
    }
  }

  async request(method, apiPath, body) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    const response = await fetch(this.baseUrl + apiPath, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.absorb(response);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const message = data && data.error ? data.error.message : "HTTP " + response.status;
      throw new Error(method + " " + apiPath + " 失败：" + message);
    }
    return data;
  }

  get(apiPath) {
    return this.request("GET", apiPath);
  }

  post(apiPath, body) {
    return this.request("POST", apiPath, body);
  }

  patch(apiPath, body) {
    return this.request("PATCH", apiPath, body);
  }

  del(apiPath) {
    return this.request("DELETE", apiPath);
  }

  async register(username, password = "password123", displayName) {
    const result = await this.post("/api/auth/register", { username, password, displayName });
    return result.user;
  }

  async login(username, password = "password123") {
    const result = await this.post("/api/auth/login", { username, password });
    return result.user;
  }

  async guest(displayName) {
    const result = await this.post("/api/auth/guest", { displayName });
    return result.user;
  }

  async createRoom(payload) {
    const result = await this.post("/api/rooms", payload);
    return result.room;
  }
}
