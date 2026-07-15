export const log = (
	level: 'log' | 'info' | 'error' | 'warn',
	title: string,
	...content: unknown[]
) => {
	const prefix = [
		`%c[boobrie] %c${title} %c${new Date().toISOString()}`,
		`font-weight: normal; color: ${
			level === 'error'
				? 'red'
				: level === 'info'
					? 'cyan'
					: level === 'warn'
						? 'yellow'
						: 'initial'
		};`,
		'color: inherit; font-weight: normal;',
		'color: gray; font-weight: lighter; font-size: 0.9em;',
	];
	console.log(...prefix, ...content);
};
