export function truncateLink(link: string | URL): string {
	const url = new URL(link);
	const rest = url.href.replace(url.origin, '');
	if (rest.length < 15) return `${url.origin}${rest}`;
	return `${url.origin}${rest.slice(0, 5)}…${rest.slice(-5)}`;
}
