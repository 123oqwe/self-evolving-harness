/**
 * L0S-T04b — per-session sentinel 生成 + 真实值映射表
 *
 * sentinel = `sentinel_<sessionId>_<keyName>`，映射表存 brain 域内存（Map），
 * 永不落盘、永不序列化进 session log（T01）。session 结束 vault 销毁。
 *
 * 该模块为纯函数 + 可注入 sessionId 的轻量类，便于 T05 canary 注入复用。
 */

import { randomUUID } from "node:crypto";

export interface SessionVault {
  readonly sessionId: string;
  /** 注册一个真实凭据（key 名 + 真实值），返回其 sentinel 占位符。 */
  register(keyName: string, realValue: string): string;
  /** 由 sentinel 反查真实值（命中则返回，未命中返回 undefined）。 */
  resolve(sentinel: string): string | undefined;
  /** 由 key 名查 sentinel（命中则返回，未命中返回 undefined）。 */
  sentinelFor(keyName: string): string | undefined;
  /** 由真实值反查 sentinel。 */
  sentinelByValue(realValue: string): string | undefined;
  /** 销毁映射表（brain 域内存释放）。 */
  destroy(): void;
}

export function createSessionVault(sessionId?: string): SessionVault {
  const sid = sessionId ?? randomUUID();
  // key 名（小写归一）→ sentinel。
  const byName = new Map<string, string>();
  // sentinel → 真实值。
  const bySentinel = new Map<string, string>();
  // 真实值 → sentinel。
  const byValue = new Map<string, string>();

  const normalize = (keyName: string): string =>
    keyName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  const vault: SessionVault = {
    sessionId: sid,
    register(keyName: string, realValue: string): string {
      const norm = normalize(keyName);
      const sentinel = `sentinel_${sid}_${norm}`;
      byName.set(norm, sentinel);
      bySentinel.set(sentinel, realValue);
      byValue.set(realValue, sentinel);
      return sentinel;
    },
    resolve(sentinel: string): string | undefined {
      return bySentinel.get(sentinel);
    },
    sentinelFor(keyName: string): string | undefined {
      return byName.get(normalize(keyName));
    },
    sentinelByValue(realValue: string): string | undefined {
      return byValue.get(realValue);
    },
    destroy(): void {
      byName.clear();
      bySentinel.clear();
      byValue.clear();
    },
  };
  return vault;
}
