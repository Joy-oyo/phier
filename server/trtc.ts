import { createHmac, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { TrtcCredentials } from '../shared/types';

export interface TrtcConfig {
  sdkAppId: number;
  sdkSecretKey: string;
  sourceLanguage: string;
  targetLanguage: string;
}

/** Target languages TRTC can translate into. Source: https://trtc.io/document/79355 */
export const trtcTargetLanguages = [
  'zh',
  'en',
  'vi',
  'ja',
  'ko',
  'id',
  'th',
  'pt',
  'ar',
  'es',
  'fr',
  'ms',
  'de',
  'it',
  'ru',
] as const;

export function readTrtcConfig(env: Record<string, string | undefined>): TrtcConfig | null {
  const sdkAppId = Number(env.TRTC_SDK_APP_ID?.trim());
  const sdkSecretKey = env.TRTC_SDK_SECRET_KEY?.trim();
  if (!Number.isInteger(sdkAppId) || sdkAppId <= 0 || !sdkSecretKey) return null;
  return {
    sdkAppId,
    sdkSecretKey,
    sourceLanguage: env.TRTC_SOURCE_LANGUAGE?.trim() || 'ja',
    targetLanguage: env.TRTC_TARGET_LANGUAGE?.trim() || 'en',
  };
}

function escapeBase64Url(value: string) {
  return value.replace(/\+/g, '*').replace(/\//g, '-').replace(/=/g, '_');
}

/**
 * TLSSigAPIv2 (https://trtc.io/document/35166). UserSig is always minted here so the
 * SDKSecretKey never reaches the browser.
 */
export function generateUserSig(config: TrtcConfig, userId: string, expireSeconds = 3600) {
  const currTime = Math.floor(Date.now() / 1000);
  const contentToBeSigned =
    `TLS.identifier:${userId}\n` +
    `TLS.sdkappid:${config.sdkAppId}\n` +
    `TLS.time:${currTime}\n` +
    `TLS.expire:${expireSeconds}\n`;
  const sig = createHmac('sha256', config.sdkSecretKey).update(contentToBeSigned).digest('base64');
  const document = {
    'TLS.ver': '2.0',
    'TLS.identifier': userId,
    'TLS.sdkappid': Number(config.sdkAppId),
    'TLS.time': currTime,
    'TLS.expire': Number(expireSeconds),
    'TLS.sig': sig,
  };
  return escapeBase64Url(deflateSync(Buffer.from(JSON.stringify(document))).toString('base64'));
}

export function createTrtcCredentials(config: TrtcConfig, targetLanguage: string): TrtcCredentials {
  // userId: letters, digits, underscores and hyphens only, max 32 bytes.
  const userId = `phier_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  return {
    sdkAppId: config.sdkAppId,
    userId,
    userSig: generateUserSig(config, userId),
    roomId: 1 + Math.floor(Math.random() * 2_000_000_000),
    sourceLanguage: config.sourceLanguage,
    targetLanguage,
  };
}
