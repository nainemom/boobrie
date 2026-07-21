import { type FormEvent, useEffect, useState } from 'react';
import { Link, Redirect } from 'wouter';
import type { MeResponse } from '@/shared/protocol';
import { getMe } from './relay';
import { logout } from './services/auth';
import { avatar } from './services/avatar';
import { signature } from './services/signature';
import {
	changeHandle,
	disablePush,
	enablePush,
	grantPermission,
	RELAY_URL,
	useStore,
} from './store';

export function SettingsPage() {
	const store = useStore();

	const [profile, setProfile] = useState<MeResponse | null>(null);
	const [handleInput, setHandleInput] = useState(store.handle ?? '');
	const [handleError, setHandleError] = useState<string | null>(null);
	const [handleSuccess, setHandleSuccess] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: also refetch when handle/push status change server-side
	useEffect(() => {
		if (!store.session) return;
		getMe(RELAY_URL, store.session.token)
			.then(setProfile)
			.catch(() => {});
	}, [store.session, store.handle, store.pushStatus]);

	if (!store.identity || !store.session) return <Redirect to="/auth" />;

	const { address } = store.identity;

	const submitHandle = (event: FormEvent) => {
		event.preventDefault();
		setHandleError(null);
		setHandleSuccess(false);
		changeHandle(handleInput)
			.then(() => setHandleSuccess(true))
			.catch((error) =>
				setHandleError(error instanceof Error ? error.message : String(error)),
			);
	};

	return (
		<main>
			<p>
				<Link href="/conversations">Back to conversations</Link>
			</p>
			<h1>Settings</h1>

			<section>
				<h2>Your identity</h2>
				{/* SVGs stroke in currentColor and carry no intrinsic size; let them
				    fill the box, height following the viewBox. */}
				<style>
					{'.avatar svg, .signature svg{display:block;width:100%;height:auto}'}
				</style>
				<div
					className="avatar"
					style={{ maxWidth: 240, margin: '1rem 0' }}
					// biome-ignore lint/security/noDangerouslySetInnerHtml: self-generated SVG, no user-controlled markup
					dangerouslySetInnerHTML={{ __html: avatar(address) }}
				/>
				<div
					className="signature"
					style={{ maxWidth: 240, margin: '1rem 0' }}
					// biome-ignore lint/security/noDangerouslySetInnerHtml: self-generated SVG, no user-controlled markup
					dangerouslySetInnerHTML={{ __html: signature(address) }}
				/>
				<p>
					Public key: <code style={{ wordBreak: 'break-all' }}>{address}</code>
				</p>
			</section>

			<section>
				<h2>Handle</h2>
				<form onSubmit={submitHandle}>
					<label htmlFor="handle-input">Handle</label>
					<input
						id="handle-input"
						value={handleInput}
						onChange={(event) => setHandleInput(event.target.value)}
						placeholder="No handle set"
					/>
					<button type="submit" disabled={handleInput.trim() === ''}>
						Save
					</button>
				</form>
				{handleSuccess ? <p>Handle updated.</p> : null}
				{handleError ? (
					<p role="alert">
						<strong>Could not update handle:</strong> {handleError}
					</p>
				) : null}
			</section>

			<section>
				<h2>Notifications</h2>
				<p>
					Permission: <output>{store.permission}</output>
				</p>
				<button
					type="button"
					onClick={() => grantPermission()}
					disabled={
						store.permission === 'granted' || store.permission === 'denied'
					}
				>
					Grant notification permission
				</button>{' '}
				<button
					type="button"
					onClick={() =>
						store.pushStatus === 'subscribed' ? disablePush() : enablePush()
					}
					disabled={
						store.permission !== 'granted' ||
						!store.vapidPublicKey ||
						store.pushStatus === 'subscribing' ||
						store.pushStatus === 'unsubscribing'
					}
				>
					{store.pushStatus === 'subscribed'
						? 'Unsubscribe this device'
						: 'Subscribe this device'}
				</button>
				{store.pushError ? (
					<p role="alert">
						<strong>Push error:</strong> {store.pushError}
					</p>
				) : null}
			</section>

			<section>
				<h2>Profile</h2>
				<pre>
					<code>{profile ? JSON.stringify(profile, null, 2) : 'Loading…'}</code>
				</pre>
			</section>

			<section>
				<h2>Account</h2>
				<p>
					Logging out removes this account's key from this device. You'll need
					your 12 words to sign back in.
				</p>
				<button type="button" onClick={() => logout()}>
					Log out
				</button>
			</section>
		</main>
	);
}
