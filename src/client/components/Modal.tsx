import { ChevronLeftIcon, XIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { tv } from 'tailwind-variants';
import { Button } from './Button';

const panel = tv({
	base: 'max-h-[calc(100%-2rem)] w-full max-w-sm overflow-x-visible overflow-y-auto rounded-sm p-3 bg-neutral-50 text-neutral-800',
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
				<div className="mb-3 flex gap-3">
					{backButton && (
						<Button
							onClick={onBack}
							disabled={backDisabled}
							iconOnly
							className="shrink-0"
							size={8}
							variant="transparent"
						>
							<ChevronLeftIcon size={16} />
						</Button>
					)}
					<div className="grow">
						{titleContent && (
							<h3 className="text-2xl font-bold flex items-center gap-1">
								{titleContent}
							</h3>
						)}
						{subtitleContent && (
							<p className="text-sm text-neutral-500">{subtitleContent}</p>
						)}
					</div>
					{closeButton && (
						<Button
							onClick={onClose}
							iconOnly
							className="shrink-0"
							size={8}
							variant="transparent"
						>
							<XIcon size={16} />
						</Button>
					)}
				</div>
			)}
			{children}
		</div>
	</div>
);
