export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, code = "bad_request", details?: unknown): AppError {
  return new AppError(400, code, message, details);
}

export function unauthorized(message = "请先登录", code = "unauthorized"): AppError {
  return new AppError(401, code, message);
}

export function forbidden(message = "没有权限执行该操作", code = "forbidden"): AppError {
  return new AppError(403, code, message);
}

export function notFound(message = "资源不存在", code = "not_found"): AppError {
  return new AppError(404, code, message);
}

export function conflict(message: string, code = "conflict"): AppError {
  return new AppError(409, code, message);
}

export function tooManyRequests(message = "操作太频繁，请稍后再试", code = "rate_limited"): AppError {
  return new AppError(429, code, message);
}

export function internalError(message = "服务器内部错误", code = "internal"): AppError {
  return new AppError(500, code, message);
}
