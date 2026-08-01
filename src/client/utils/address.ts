/** Shorten a base58 address to a display-friendly "abcde...vwxyz" form. */
export function truncateAddress(address: string): string {
	return `${address.slice(0, 5)}…${address.slice(-5)}`;
}
