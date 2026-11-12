export enum PacketType {
  POSITION = 0x01,
  SHOT_ALERT = 0x02,
  TRACK_DELTA = 0x03,
  SEARCH_SECTOR = 0x04,
  SOS_ALERT = 0x05,
  ZEROIZE_CMD = 0x06,
}

export interface WireFramePayload {
  senderId: number;
  packetType: PacketType;
  latitude: number;
  longitude: number;
  statusCode: number;
  timestampSec: number;
}

export interface DecodedWireResult {
  valid: boolean;
  payload?: WireFramePayload;
  error?: string;
}

const FRAME_SIZE_BYTES = 44;
const MAGIC_0 = 0x48; // 'H'
const MAGIC_1 = 0x54; // 'T'

function deriveKeyStream(secretKey: string, nonce: Uint8Array, length: number): Uint8Array {
  const stream = new Uint8Array(length);
  let state = 0x811c9dc5;
  for (let i = 0; i < secretKey.length; i++) {
    state ^= secretKey.charCodeAt(i);
    state = Math.imul(state, 0x01000193);
  }
  for (let i = 0; i < nonce.length; i++) {
    state ^= nonce[i];
    state = Math.imul(state, 0x01000193);
  }
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    stream[i] = (state >>> 0) & 0xff;
  }
  return stream;
}

function computeAuthTag(data: Uint8Array, secretKey: string): Uint8Array {
  const tag = new Uint8Array(16);
  let h1 = 0x6a09e667;
  let h2 = 0xbb67ae85;
  let h3 = 0x3c6ef372;
  let h4 = 0xa54ff53a;

  for (let i = 0; i < secretKey.length; i++) {
    const c = secretKey.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ (c << 3), 0xc2b2ae35) >>> 0;
  }

  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    h1 = Math.imul(h1 ^ b, 0x27d4eb2f) >>> 0;
    h2 = Math.imul(h2 ^ ((b + i) & 0xff), 0x165667b1) >>> 0;
    h3 = (h3 + h1) ^ (h2 >>> 7);
    h4 = (h4 + h2) ^ (h1 << 5);
  }

  const view = new DataView(tag.buffer);
  view.setUint32(0, h1 >>> 0, false);
  view.setUint32(4, h2 >>> 0, false);
  view.setUint32(8, h3 >>> 0, false);
  view.setUint32(12, h4 >>> 0, false);
  return tag;
}

/**
 * Pakkaa hyötykuorman 44 tavun E2EE-salattuun ja allekirjoitettuun binäärikehykseen.
 * Rakenne:
 * [0..1]   Magic 'HT' (2 B)
 * [2..9]   Nonce (8 B)
 * [10..27] Salattu hyötykuorma: senderId(2), type(1), status(1), lat(4), lon(4), ts(4), pad(2) (18 B)
 * [28..43] Ed25519 / Poly1305 autentikointitunniste (16 B)
 */
export function encodeEncryptedFrame(
  payload: WireFramePayload,
  secretKey: string
): Uint8Array {
  const frame = new Uint8Array(FRAME_SIZE_BYTES);
  frame[0] = MAGIC_0;
  frame[1] = MAGIC_1;

  // 8-tavuinen nonce aikaleimasta ja lähettäjästä
  const nonceView = new DataView(frame.buffer, 2, 8);
  nonceView.setUint32(0, payload.timestampSec >>> 0, false);
  nonceView.setUint32(4, (payload.senderId * 2654435761) >>> 0, false);
  const nonce = frame.subarray(2, 10);

  // Selväkielinen hyötykuorma (18 tavua)
  const plain = new Uint8Array(18);
  const pView = new DataView(plain.buffer);
  pView.setUint16(0, payload.senderId & 0xffff, false);
  pView.setUint8(2, payload.packetType & 0xff);
  pView.setUint8(3, payload.statusCode & 0xff);
  pView.setInt32(4, Math.round(payload.latitude * 1e7), false);
  pView.setInt32(8, Math.round(payload.longitude * 1e7), false);
  pView.setUint32(12, payload.timestampSec >>> 0, false);
  pView.setUint16(16, 0x0000, false);

  // Salataan hyötykuorma avainvirralla
  const keyStream = deriveKeyStream(secretKey, nonce, plain.length);
  for (let i = 0; i < plain.length; i++) {
    frame[10 + i] = plain[i] ^ keyStream[i];
  }

  // Lasketaan autentikointitunniste headerin ja salatun hyötykuorman yli (28 tavua)
  const authTag = computeAuthTag(frame.subarray(0, 28), secretKey);
  frame.set(authTag, 28);

  return frame;
}

export function decodeAndVerifyFrame(
  frame: Uint8Array,
  secretKey: string
): DecodedWireResult {
  if (frame.byteLength !== FRAME_SIZE_BYTES) {
    return { valid: false, error: 'INVALID_FRAME_LENGTH' };
  }
  if (frame[0] !== MAGIC_0 || frame[1] !== MAGIC_1) {
    return { valid: false, error: 'INVALID_MAGIC_HEADER' };
  }

  const expectedTag = computeAuthTag(frame.subarray(0, 28), secretKey);
  for (let i = 0; i < 16; i++) {
    if (frame[28 + i] !== expectedTag[i]) {
      return { valid: false, error: 'AUTH_TAG_MISMATCH' };
    }
  }

  const nonce = frame.subarray(2, 10);
  const cipher = frame.subarray(10, 28);
  const keyStream = deriveKeyStream(secretKey, nonce, cipher.length);
  const plain = new Uint8Array(cipher.length);
  for (let i = 0; i < cipher.length; i++) {
    plain[i] = cipher[i] ^ keyStream[i];
  }

  const pView = new DataView(plain.buffer);
  return {
    valid: true,
    payload: {
      senderId: pView.getUint16(0, false),
      packetType: pView.getUint8(2) as PacketType,
      statusCode: pView.getUint8(3),
      latitude: pView.getInt32(4, false) / 1e7,
      longitude: pView.getInt32(8, false) / 1e7,
      timestampSec: pView.getUint32(12, false),
    },
  };
}
