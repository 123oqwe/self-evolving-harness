/**
 * L0S-T04b — SigV4 重签（自实现精简 AWS 签名 v4）
 *
 * 为避免 SDK 重依赖，自实现 canonical request + string-to-sign + HMAC-SHA256 链。
 * 真实 secret 仅在 brain/proxy 域参与 HMAC，签名结果 header 注入请求；真实 secret
 * 永不进 hands 域、永不出现在请求 header 明文中。
 *
 * 参考：AWS SigV4 规范（canonical request / string to sign / signing key 链）。
 */

import {
  createHash,
  createHmac,
} from "node:crypto";

export interface SigV4SignOpts {
  method: string;
  url: string;
  headers: Record<string, string>;
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  /** 可选：请求体（用于计算 x-amz-content-sha256）。缺省按空串计算。 */
  body?: string;
  /** 可选：覆盖 X-Amz-Date（YYYYMMDDTHHMMSSZ）。缺省取当前 UTC。 */
  date?: string;
}

export interface SigV4SignResult {
  headers: Record<string, string>;
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * 由 URL 解析 host 与 path。host 优先取 headers.Host，否则取 URL host。
 */
function deriveHostAndPath(
  url: string,
  headers: Record<string, string>,
): { host: string; path: string; query: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // 容错：视为纯 path。
    return { host: headers.Host ?? "", path: url, query: "" };
  }
  const host = headers.Host ?? parsed.host;
  const path = parsed.pathname === "" ? "/" : parsed.pathname;
  const query = parsed.search.replace(/^\?/, "");
  return { host, path, query };
}

function buildCanonicalQuery(query: string): string {
  if (query === "") return "";
  // 按 key 排序。
  const pairs = query.split("&").filter(Boolean);
  pairs.sort();
  return pairs.map((p) => p).join("&");
}

/**
 * 计算精简 AWS SigV4 签名，返回含 Authorization / X-Amz-Date / X-Amz-Content-Sha256
 * 的 header 集合（合并入原始 headers，原始 Authorization 被覆盖）。
 */
export function sigV4Sign(opts: SigV4SignOpts): SigV4SignResult {
  const {
    method,
    url,
    headers,
    accessKey,
    secretKey,
    region,
    service,
  } = opts;

  const body = opts.body ?? "";
  const now = opts.date ?? new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  // now 形如 YYYYMMDDTHHMMSSZ；dateOnly = 前 8 位。
  const dateOnly = now.slice(0, 8);

  const { host, path, query } = deriveHostAndPath(url, headers);

  // 构造签名 header 集合：拷贝原始 header（剔除原 Authorization），补 host/x-amz-date/x-amz-content-sha256。
  const signed: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "authorization") continue;
    signed[k] = v;
  }
  if (signed.Host === undefined && signed.host === undefined) {
    signed.Host = host;
  }
  signed["X-Amz-Date"] = now;
  signed["X-Amz-Content-Sha256"] = sha256Hex(body);

  // canonical headers：小写名 + trim 值，按名排序，每行后接 \n。
  const headerEntries = Object.entries(signed)
    .map(([k, v]) => [k.toLowerCase(), String(v).trim()] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalHeaders =
    headerEntries.map(([k, v]) => `${k}:${v}`).join("\n") + "\n";
  const signedHeaders = headerEntries.map(([k]) => k).join(";");

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    buildCanonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join("\n");

  const credentialScope = `${dateOnly}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    now,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  // signing key 链：HMAC("AWS4"+secret, date) → region → service → "aws4_request"。
  const kDate = hmac(`AWS4${secretKey}`, dateOnly);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  signed.Authorization = authorization;
  return { headers: signed };
}
