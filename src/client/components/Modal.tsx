import { ChevronLeftIcon, XIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { twJoin } from 'tailwind-merge';
import { tv } from 'tailwind-variants';
import { Button } from './Button';

const panel = tv({
	base: 'max-h-[calc(100%-2rem)] w-full max-w-md overflow-x-visible overflow-y-auto rounded-sm p-3 bg-neutral-50 text-neutral-800',
});

/**
 * A centered panel over a dimmed backdrop. Purely presentational and with no
 * close control of its own — whoever mounts it decides when it's shown, so it
 * can serve both dismissible dialogs and a forced gate that stays put.
 */
export const Modal: FC<{
	children: ReactNode;
	title?: ReactNode;
	subtitle?: ReactNode;
	closeButton?: boolean;
	onClose?: () => void;
	backButton?: boolean;
	backDisabled?: boolean;
	onBack?: () => void;
	className?: string;
}> = ({
	title: titleContent,
	subtitle: subtitleContent,
	closeButton,
	backButton,
	backDisabled,
	onBack,
	onClose,
	children,
	className,
}) => (
	<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
		<div className={panel({ class: className })}>
			{(titleContent || subtitleContent || closeButton || backButton) && (
				<div className="flex flex-col gap-1 mb-6">
					<div className="flex gap-3">
						<Button
							onClick={onBack}
							disabled={backDisabled}
							iconOnly
							className={twJoin('shrink-0', !backButton && 'invisible')}
							size={8}
							variant="transparent"
						>
							<ChevronLeftIcon size={20} />
						</Button>
						<div className="grow">
							{titleContent && (
								<h3 className="text-xl font-bold grow mt-0.5 text-center">
									{titleContent}
								</h3>
							)}
						</div>
						<Button
							onClick={onClose}
							iconOnly
							className={twJoin('shrink-0', !closeButton && 'invisible')}
							size={8}
							variant="transparent"
						>
							<XIcon size={20} />
						</Button>
					</div>
					{subtitleContent && (
						<p className="text-sm text-neutral-500">{subtitleContent}</p>
					)}
				</div>
			)}
			{children}
		</div>
	</div>
);
