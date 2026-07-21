import { createAvatar } from '@dicebear/core';
import * as notionists from '@dicebear/notionists';

export function avatar(address: string): string {
	const avatar = createAvatar(notionists, {
		seed: address,
	});
	const svg = avatar.toString();
	return svg;
}
