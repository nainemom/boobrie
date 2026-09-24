import {
	defineHandler,
	getValidatedRouterParams,
	HTTPError,
	redirect,
} from 'h3';
import {
	redirectUserSchema,
	type UserResponse,
	userParamsSchema,
} from '@/shared/protocol';
import { db } from '../db/index.ts';
import { isOnline } from './messaging.ts';

export const redirectUserHandler = (newPath: string) =>
	defineHandler(async (event) => {
		const { handle } = await getValidatedRouterParams(
			event,
			redirectUserSchema,
		);

		const record = await db.user.findUnique({
			where: { handle },
			select: { address: true },
		});

		if (!record) {
			throw new HTTPError({ status: 404, message: 'user not found' });
		}

		return redirect(newPath.replace(':address', record.address));
	});

export const getUserHandler = defineHandler(async (event) => {
	const { address } = await getValidatedRouterParams(event, userParamsSchema);

	const record = await db.user.findUnique({ where: { address } });

	if (!record) {
		throw new HTTPError({ status: 404, message: 'user not found' });
	}

	return {
		address: record.address,
		handle: record.handle,
		online: record.onlineStatus ? await isOnline(record.address) : null,
		createdAt: record.createdAt,
	} satisfies UserResponse;
});
