import { CopyCheckIcon, CopyIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export const useCopyToClipboard = () => {
	const [copied, setCopied] = useState(false);
	const tm = useRef<ReturnType<typeof setTimeout> | null>(null);

	const copyToClipboard = useCallback((content: string) => {
		navigator.clipboard?.writeText(content).then(() => {
			setCopied(true);
			tm.current = setTimeout(() => setCopied(false), 1500);
		});
	}, []);

	useEffect(() => {
		return () => {
			if (tm.current) {
				clearTimeout(tm.current);
			}
		};
	}, []);

	return [copied ? CopyCheckIcon : CopyIcon, copyToClipboard] as const;
};
