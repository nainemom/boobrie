import { CheckCircle2Icon, LoaderIcon } from 'lucide-react';
import type { FC } from 'react';
import { useSyncStatus } from '../services/sync';

export const SyncStatus: FC = () => {
	const syncStatus = useSyncStatus();
	return (
		<div className="inline-flex items-center gap-1 text-xs font-normal text-neutral-800 font-mono">
			{!syncStatus ? (
				<LoaderIcon size={16} className="animate-spin text-neutral-500" />
			) : (
				<CheckCircle2Icon size={16} />
			)}
		</div>
	);
};
