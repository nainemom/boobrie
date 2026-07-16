/**
 * Protocol-wide constants shared by the client and the server.
 *
 * Everything here is deliberately plain data so both a browser bundle and a
 * Node process can import it without pulling in anything environment-specific.
 */

/** HKDF `info` label used when deriving the one-off AES key for the auth challenge. */
export const AUTH_KDF_INFO = 'viska-auth-challenge';

/** List of reserved usernames/handles that users cannot claim. */
export const RESERVED_HANDLES = [
	'admin',
	'administrator',
	'system',
	'support',
	'moderator',
	'staff',
	'help',
	'root',
	'boobrie',
	'relay',
	'service',
	'guest',
	'api',
	'null',
	'undefined',
] as const;

/** Regular expression for validating standard clean handles/usernames.
 * - Only lowercase alphanumeric characters, single hyphens, and single underscores.
 * - Cannot start or end with a hyphen/underscore.
 * - No consecutive hyphens or underscores (e.g. no double dashes).
 */
export const HANDLE_REGEX = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
