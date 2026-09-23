export default {
	async fetch(request) {
		const response = await fetch(request);
		if (response.status !== 404) return response;

		const { pathname } = new URL(request.url);
		const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
		if (lastSegment.includes('.')) return response;

		return new Response(response.body, {
			status: 200,
			statusText: 'OK',
			headers: response.headers,
		});
	},
};
