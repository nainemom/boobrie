/**
 * The presence hub: who is connected right now.
 *
 * A single in-memory map of address → live socket. One active device per address
 * — a second connection for the same address kicks the first (the protocol's
 * `kicked`). This is the relay's only notion of "online"; it is deliberately not
 * shared, since only the relay process routes sockets.
 */

import type { WebSocket } from 'ws';
import { log } from '@/shared/log';
import type { ServerMsg } from '@/shared/protocol';

const sockets = new Map<string, WebSocket>();

export function register(address: string, socket: WebSocket): void {
	const existing = sockets.get(address);
	if (existing && existing !== socket) {
		try {
			existing.send(JSON.stringify({ t: 'kicked' } satisfies ServerMsg));
		} catch {
			// The old socket may already be gone; closing is what matters.
		}
		existing.close();
	}
	sockets.set(address, socket);
}

export function unregister(address: string, socket: WebSocket): void {
	if (sockets.get(address) === socket) sockets.delete(address);
}

export function isOnline(address: string): boolean {
	const socket = sockets.get(address);
	return socket !== undefined && socket.readyState === socket.OPEN;
}

export function sendTo(address: string, msg: ServerMsg): boolean {
	const socket = sockets.get(address);
	if (!socket || socket.readyState !== socket.OPEN) return false;
	try {
		socket.send(JSON.stringify(msg));
		return true;
	} catch (err) {
		log('warn', 'ws send failed', address, err);
		return false;
	}
}
