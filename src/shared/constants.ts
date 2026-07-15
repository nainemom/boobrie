/**
 * Protocol-wide constants shared by the client and the server.
 *
 * Everything here is deliberately plain data so both a browser bundle and a
 * Node process can import it without pulling in anything environment-specific.
 */

/** HKDF `info` label used when deriving the one-off AES key for the auth challenge. */
export const AUTH_KDF_INFO = 'viska-auth-challenge';
