import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import unpluginFavicons from '@anolilab/unplugin-favicons/vite';
import { serwist } from '@serwist/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import openGraph from 'vite-plugin-open-graph';
import pkg from './package.json';
import { env } from './src/client/env.ts';

const LOGO = 'src/client/public/logo.svg';

/** How the app introduces itself — to a browser tab, an install prompt, a
 * search result and a chat unfurl alike. `index.html` writes these as `%TOKEN%`
 * and the plugin below fills them in, so the name and the description exist
 * once: a `<title>`, an `og:title` and a manifest `name` drifting apart is the
 * usual way this goes wrong. */
const site = {
	name: 'Boobrie',
	title: 'Boobrie - Chat Without an Identity',
	description:
		'Boobrie is a free, open-source chat service with end-to-end encryption. No email, no phone number, no contacts — your identity is just a recovery phrase.',
	/** `bg-neutral-50`, the app surface `#root` is painted with — so the install
	 * splash and the mobile address bar match the top of the page instead of
	 * flashing a colour that appears nowhere in the UI. */
	color: '#fafafa',
	/** Trailing slash stripped once here, so every URL can add its own and
	 * `CLIENT_PUBLIC_URL=https://x.com/` can't produce `https://x.com//og.png`. */
	origin: env.CLIENT_PUBLIC_URL.replace(/\/+$/, ''),
};

/** The same mark, prepared for Android's adaptive icons: painted onto an opaque
 * square and scaled to 80%, so the disc sits inside the central safe zone no
 * mask is allowed to crop. It's composed here by nesting `logo.svg` inside a
 * wrapper — rather than checked in as a second drawing that would have to be
 * re-exported every time the first one changes. */
const logoSvg = readFileSync(LOGO, 'utf8');
const maskableLogo = Buffer.from(
	[
		'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
		`<rect width="512" height="512" fill="${site.color}"/>`,
		// The drawing, minus its XML prologue — that's only legal at the top of a
		// document, and would make the wrapper unparseable.
		`<g transform="translate(51.2 51.2) scale(0.8)">${logoSvg.slice(logoSvg.indexOf('<svg'))}</g>`,
		'</svg>',
	].join(''),
);

/** The share card: `src/arts/og.svg`, exported by hand to `public/og.png` at
 * Open Graph's 1200x630 and checked in — nothing in the build rasterises it.
 * Stating the dimensions and the type here lets an unfurler lay the card out
 * before it has finished fetching the image — and the `alt` is the only part of
 * a shared link a screen reader has to go on. */
const ogImage = {
	url: `${site.origin}/og.png`,
	type: 'image/png',
	width: 1200,
	height: 630,
	alt: 'The Boobrie logo above the words "Boobrie - Chat Without an Identity".',
};

/** What `index.html` writes as `%TOKEN%`. The origin is in here because
 * a crawler discards a relative `canonical`, and it isn't known until a build
 * picks one. */
const tokens: Record<string, string> = {
	'%SITE_TITLE%': site.title,
	'%SITE_DESCRIPTION%': site.description,
	'%CLIENT_PUBLIC_URL%': site.origin,
	'%APP_VERSION%': pkg.version,
};

/**
 * Fills those tokens in, and applies the two head fixups that have to happen
 * after unplugin-favicons has had its turn — hence `order: 'post'`.
 *
 * `robots.txt` and `sitemap.xml` are emitted here from the same origin rather
 * than checked into `public/`, where they would freeze one deploy's domain
 * into the repo.
 */
const siteMetadata = (): Plugin => ({
	name: 'boobrie:site-metadata',
	transformIndexHtml: {
		order: 'post',
		handler(html, ctx) {
			let out = Object.entries(tokens).reduce(
				(acc, [token, value]) => acc.replaceAll(token, value),
				html,
			);
			// unplugin-favicons drops any `rel="icon"` already in the document
			// before injecting its own, so this can't just live in `index.html`.
			// It's worth re-adding: that generator only emits bitmaps, and a
			// browser that understands an SVG favicon should be handed the sharp
			// one — 673 bytes that stay crisp at every size, against a 33 kB `.ico`
			// that doesn't.
			out = out.replace(
				'</head>',
				'<link rel="icon" type="image/svg+xml" href="/logo.svg"></head>',
			);
			// The comments in `index.html` explain the tags to whoever edits the
			// file; they have no reason to travel to every visitor. Dev keeps them,
			// so view-source still matches the file on disk.
			return ctx.server ? out : out.replace(/<!--[\s\S]*?-->\s*/g, '');
		},
	},
	generateBundle(_options, bundle) {
		// unplugin-favicons writes the manifest from a fixed list of options of
		// its own, and link handling isn't on it — so the two members that make
		// an installed copy the default opener for its own URLs are merged in
		// here, after it has emitted the file during `buildStart`. Only in a
		// build: the dev server answers from the plugin's own middleware, and a
		// localhost install is not what any of this is for.
		const manifest = Object.values(bundle).find(
			(file) => file.type === 'asset' && file.fileName.endsWith('.webmanifest'),
		);
		if (manifest?.type !== 'asset' || typeof manifest.source !== 'string') {
			throw new Error(
				'no web app manifest in the bundle — unplugin-favicons emits one on ' +
					'every build, so it has either stopped or renamed the file',
			);
		}
		manifest.source = JSON.stringify({
			...(JSON.parse(manifest.source) as Record<string, unknown>),
			// "When this app is installed, it should be what opens links inside its
			// scope" — which is every URL on the origin (`scope: '/'` above), so an
			// invite someone tapped in another app arrives in the installed app
			// rather than a browser tab. A preference, not a rule: the user can turn
			// it off per app, and browsers that don't implement it ignore it.
			handle_links: 'preferred',
			// Where such a link lands: the window that is already open, navigated to
			// the URL that was tapped, rather than a second copy of the app beside
			// it. `focus-existing` would spare the reload — it focuses the window
			// and leaves the URL to `launchQueue` — but only if the app also routes
			// that URL itself, and a boot from the local database is cheap enough
			// not to be worth the moving part.
			launch_handler: { client_mode: 'navigate-existing' },
		});

		// `/:handle` is deliberately left crawlable. A blanket `Disallow: /` with
		// an `Allow: /$` exception is the only way to express "the landing page
		// and nothing else", and crawlers that don't implement `$` read that as
		// "index nothing at all" — too sharp an edge for the gain. The `canonical`
		// in `index.html` covers it safely instead: every route is served the same
		// shell, so they all collapse onto the landing page.
		this.emitFile({
			type: 'asset',
			fileName: 'robots.txt',
			source: [
				// Link-preview fetchers, not indexers: they read a URL only because
				// someone just pasted it, and a `Disallow` here is what turns that
				// share into a bare link instead of a card. A crawler that finds a
				// group naming it obeys only that group, so this doesn't loosen the
				// `*` rule for search engines.
				'User-agent: Twitterbot',
				'User-agent: facebookexternalhit',
				'User-agent: LinkedInBot',
				'User-agent: Slackbot',
				'User-agent: Discordbot',
				'User-agent: TelegramBot',
				'User-agent: WhatsApp',
				'Allow: /',
				'',
				'User-agent: *',
				// An invite URL carries the invitee's address in the path. Nothing
				// good comes of those sitting in a search index.
				'Disallow: /i/',
				'',
				`Sitemap: ${site.origin}/sitemap.xml`,
				'',
			].join('\n'),
		});
		this.emitFile({
			type: 'asset',
			fileName: 'sitemap.xml',
			// One entry, because there is one page: the `404.html` copy the deploy
			// makes answers every path with this same shell, and the router picks the
			// view client-side.
			source: `${[
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
				'\t<url>',
				`\t\t<loc>${site.origin}/</loc>`,
				'\t</url>',
				'</urlset>',
			].join('\n')}\n`,
		});
	},
});

export default defineConfig(({ command }) => {
	// The one place the client can be strict. Its env is read at build and
	// stamped into the bundle — `define` below — so there is no later moment to
	// notice a missing one, and the fallbacks in `env.ts` would quietly publish a
	// site whose links and relay both point at localhost. `vite` (dev) is left
	// alone: the fallbacks exist precisely so a bare checkout runs.
	if (command === 'build') {
		const missing = (['CLIENT_PUBLIC_URL', 'CLIENT_RELAY_URL'] as const).filter(
			(name) => !process.env[name],
		);
		if (missing.length > 0) {
			throw new Error(
				`building the client without ${missing.join(' and ')} — the ` +
					'fallbacks in `env.ts` are for `npm run dev:client`, and a build ' +
					'that takes them ships a bundle that talks to localhost',
			);
		}
	}

	return {
		server: {
			strictPort: true,
			port: env.CLIENT_PORT,
		},
		publicDir: 'src/client/public',
		plugins: [
			react(),
			tailwindcss(),
			// Rasterises the logo into the icon set every platform insists on
			// having its own way — `favicon.ico`, Android's PNGs, an
			// `apple-touch-icon` — plus the web app manifest that names and
			// describes the app on an install prompt, and injects the `<link>`s for
			// all of it into `index.html`. Icon types are opt-in here: anything not
			// listed below simply isn't rendered.
			unpluginFavicons({
				outputPath: 'favicons',
				icons: {
					// Tab and bookmark icons keep the source's transparent corners: a
					// browser tab may be dark, and a light square would sit in it like
					// a sticker.
					favicons: { source: LOGO },
					// Full-bleed is right for iOS, which masks only the corners — and
					// these are flattened onto `background` already, because any
					// transparency in a home-screen icon renders there as black.
					appleIcon: { source: LOGO },
					// These become the manifest's `purpose: "any"` icons, and "any"
					// means "draw it as it is". A desktop install takes one straight
					// into the launcher without a mask, so anything opaque here is a
					// hard-edged square on the taskbar. Left transparent, it's the same
					// round mark the tab shows; Android gets the maskable set below.
					android: { source: LOGO },
				},
				favicons: {
					appName: site.name,
					appShortName: site.name,
					appDescription: site.description,
					developerName: 'nainemom',
					developerURL: 'https://github.com/nainemom/boobrie',
					lang: 'en-US',
					start_url: '/',
					scope: '/',
					display: 'standalone',
					orientation: 'any',
					background: site.color,
					theme_color: site.color,
					// The default, `black-translucent`, lets the page run under the
					// status bar — which for this light, top-docked navbar means the
					// clock sitting on top of it.
					appleStatusBarStyle: 'default',
					// Renders a *second* Android set from `maskableLogo`, tagged
					// `purpose: "maskable"` — which is what stops Android framing the
					// icon in a white blob of its own. Handing it a source rather than
					// `true` is the point: `true` would relabel the icons above as
					// `"any maskable"`, and one image can't be both a bare mark and a
					// full-bleed square without being wrong somewhere.
					manifestMaskable: maskableLogo,
				},
			}),
			// The card Slack, iMessage, WhatsApp, LinkedIn and the rest draw when
			// someone shares a link. Built from the same `site` object as the tab
			// title and the manifest, so the three can't drift apart, and ordered
			// before `siteMetadata()` only for reading: this hook runs in Vite's
			// default phase, which is already ahead of the two `post` plugins here.
			openGraph({
				basic: {
					type: 'website',
					siteName: site.name,
					title: site.title,
					description: site.description,
					// The canonical landing page, matching `index.html`'s `canonical`:
					// `og:url` is the identity a share collapses onto, so every route
					// that unfurls has to name the same one.
					url: `${site.origin}/`,
					locale: 'en_US',
					image: ogImage,
				},
				// Twitter falls back to the `og:` tags for anything it isn't given,
				// so only the card shape strictly has to be here. The rest is spelled
				// out because that fallback is a courtesy of each crawler, not a rule
				// any of them promise to keep.
				twitter: {
					card: 'summary_large_image',
					title: site.title,
					description: site.description,
					image: ogImage.url,
					imageAlt: ogImage.alt,
				},
			}),
			// After unpluginFavicons, not before: both hook `transformIndexHtml` at
			// `order: 'post'`, where Vite runs them in plugin order, and that one
			// wipes every `rel="icon"` in the document before injecting its own.
			siteMetadata(),
			serwist({
				swSrc: 'src/client/sw.ts',
				swDest: 'sw.js',
				globDirectory: 'dist',
				// Precache every built file, not just Serwist's default js/css/html: the
				// app has to boot with no network, icons and all.
				globPatterns: [
					'**/*.{js,css,html,svg,png,ico,webp,woff,woff2,json,webmanifest}',
				],
				// The default 2 MiB cap drops oversized files from the manifest with only
				// a build warning — for the app's own bundle that would mean a silently
				// offline-broken build.
				maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
				injectionPoint: 'self.__SW_MANIFEST',
				rollupFormat: 'iife' as const,
			}),
		],
		resolve: {
			alias: {
				'@': resolve(__dirname, './src'),
			},
		},
		define: {
			'process.env': env,
			APP_VERSION: `"${pkg.version}"`,
		},
	};
});
