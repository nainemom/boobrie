import { base58 } from '@scure/base';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8ToBytes(text: string): Uint8Array<ArrayBuffer> {
	return textEncoder.encode(text) as Uint8Array<ArrayBuffer>;
}

export function bytesToUtf8(bytes: Uint8Array): string {
	return textDecoder.decode(bytes);
}

export function bytesToBase58(bytes: Uint8Array): string {
	return base58.encode(bytes);
}

export function base58ToBytes(encoded: string): Uint8Array<ArrayBuffer> {
	return base58.decode(encoded) as Uint8Array<ArrayBuffer>;
}
