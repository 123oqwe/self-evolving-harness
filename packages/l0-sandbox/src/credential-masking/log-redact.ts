/**
 * L0S-T04b — proxy egress 日志脱敏（header/body 字段 mask）
 *
 * 非 injectHosts 出站一律脱敏：header `Authorization/Cookie/X-Amz-Security-Token/
 * Set-Cookie` + body JSON 字段 `password/token/secret` mask。body 脱敏用 JSON path
 * 遍历（非正则，防漏 mask）。真实 secret 值若混入非敏感位置，也按值替换为
 * `<redacted>`（防 exfil）。
 */

/** 需整体脱敏的 header 名（小写归一匹配）。 */
export const REDACTED_HEADERS = new Set<string>([
  "authorization",
  "cookie",
  "set-cookie",
  "x-amz-security-token",
  "proxy-authorization",
]);

/** body JSON 中需脱敏的字段名（小写归一匹配）。 */
export const SENSITIVE_BODY_KEYS = new Set<string>([
  "password",
  "token",
  "secret",
  "secretkey",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "credential",
  "authorization",
]);

/** 整体 header 脱敏值。 */
export const HEADER_MASK = "<redacted>";
/** body 字段脱敏值。 */
export const BODY_MASK = "<redacted>";

function redactBodyJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => redactBodyJson(v));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_BODY_KEYS.has(k.toLowerCase())) {
        out[k] = BODY_MASK;
      } else {
        out[k] = redactBodyJson(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * 把 body 中敏感 JSON 字段脱敏。先尝试 JSON.parse；解析失败则按字符串做值替换。
 */
// sentinel 占位符前缀（与 sentinel.ts 的生成格式一致）。
const SENTINEL_PREFIX = "sentinel_";
function hasSentinelMarker(val: string): boolean {
  return val.includes(SENTINEL_PREFIX);
}

function redactBody(body: string, secretValues: string[]): string {
  if (body === "") return body;
  // 优先 JSON path 遍历。
  try {
    const parsed = JSON.parse(body) as unknown;
    const redacted = redactBodyJson(parsed);
    // JSON path 脱敏后，对结果串再叠加按值替换，保证非敏感字段里出现的
    // 真实 secret 值也被 mask（与 header 分支及模块文档承诺一致）。
    let out = JSON.stringify(redacted);
    for (const s of secretValues) {
      if (s.length === 0) continue;
      out = out.split(s).join(BODY_MASK);
    }
    return out;
  } catch {
    // 非 JSON：对真实 secret 值做字符串替换。
    let out = body;
    for (const s of secretValues) {
      if (s.length === 0) continue;
      out = out.split(s).join(BODY_MASK);
    }
    return out;
  }
}

/**
 * 对 egress 请求做脱敏：header 敏感字段整体 mask + body 敏感 JSON 字段 mask +
 * 任何位置出现的真实 secret 值替换为 `<redacted>`。
 *
 * sentinel 占位符不被脱敏（它本身不是真实 secret）。
 */
export function redactEgressRequest(
  req: {
    host: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  },
  secretValues: string[],
): {
  host: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
} {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    // 对所有 header 值按真实 secret 做替换（sentinel 占位符不属真实 secret，保留）。
    let val = String(v);
    for (const s of secretValues) {
      if (s.length === 0) continue;
      val = val.split(s).join(HEADER_MASK);
    }
    // 敏感 header 若值不含 sentinel（即非 proxy 注入的占位符），整体 mask，
    // 防未知凭据（不在 secrets 表中）外泄；含 sentinel 则保留占位符形态。
    if (REDACTED_HEADERS.has(k.toLowerCase()) && !hasSentinelMarker(val)) {
      val = HEADER_MASK;
    }
    headers[k] = val;
  }

  let body: string | undefined;
  if (typeof req.body === "string" && req.body !== "") {
    body = redactBody(req.body, secretValues);
  } else if (req.body !== undefined) {
    body = req.body;
  }

  // noUncheckedIndexedAccess + exactOptionalPropertyTypes：仅当 body 存在时挂载。
  if (body !== undefined) {
    return { host: req.host, method: req.method, url: req.url, headers, body };
  }
  return { host: req.host, method: req.method, url: req.url, headers };
}
