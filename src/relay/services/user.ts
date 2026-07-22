import { eq } from 'drizzle-orm';
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
import { users } from '../db/schema.ts';

export const redirectUserHandler = (newPath: string) =>
	defineHandler(async (event) => {
		const { handle } = await getValidatedRouterParams(
			event,
			redirectUserSchema,
		);

		const [record] = await db
			.select({
				address: users.address,
			})
			.from(users)
			.where(eq(users.handle, handle))
			.limit(1);

		if (!record) {
			throw new HTTPError({ status: 404, message: 'user not found' });
		}

		return redirect(newPath.replace(':address', record.address));
	});

export const getUserHandler = defineHandler(async (event) => {
	const { address } = await getValidatedRouterParams(event, userParamsSchema);

	const [record] = await db
		.select()
		.from(users)
		.where(eq(users.address, address))
		.limit(1);

	if (!record) {
		throw new HTTPError({ status: 404, message: 'user not found' });
	}

	return {
		address: record.address,
		handle: record.handle,
		createdAt: record.createdAt,
	} satisfies UserResponse;
});
