<div align="center">

<img src="src/client/public/logo.png" alt="" width="104" height="104">

# Boobrie

**Chat without an identity.** No email, no phone number, no contacts.
Your account is twelve words, and the server can't read a thing.

[boobrie.chat](https://boobrie.chat)

[![Test](https://github.com/nainemom/boobrie/actions/workflows/test.yml/badge.svg)](https://github.com/nainemom/boobrie/actions/workflows/test.yml)
[![Deploy](https://github.com/nainemom/boobrie/actions/workflows/deploy.yml/badge.svg)](https://github.com/nainemom/boobrie/actions/workflows/deploy.yml)
[![Version](https://img.shields.io/github/v/tag/nainemom/boobrie?label=version)](https://github.com/nainemom/boobrie/releases)

</div>

Most chat apps ask who you are before they let you talk. Boobrie doesn't, mostly
because there is nothing useful it could do with the answer: every message is
encrypted in your browser, and the relay only ever handles ciphertext addressed
to a public key. It's a PWA — install it or don't.

## Your account is twelve words

Signing up hands you a BIP-39 recovery phrase. Those words seed a P-256 key
pair; the public half **is** your address, and the private half never leaves the
device — it's kept non-extractable in IndexedDB, so even the page it belongs to
can't read the raw bytes back out. Type the same words somewhere else and you're
the same person again. Lose them and the account is gone. There's no reset link,
because there's no address to send one to.

Optionally you can claim a handle, so people have something friendlier to paste
than 44 characters of base58. Handles are claimed once, at sign-up, and they're
free — everything here is.

There's also anonymous mode. It flips one bit of your address's hash (a bit
anyone can read off any address, with no lookup), and the app then shows you as
a generated face with no name on it. Since the address *is* the key, that choice
is made once, at creation, and can't be changed later without throwing the
account away.

## Logging in without a password

```
client → POST /auth/challenge  { address }
relay  → a nonce sealed to that public key, plus a short-lived signed
         token that commits to the nonce by hash
client → opens the box with its private key
client → POST /auth/verify     { token, nonce }
relay  → session JWT
```

Only the holder of the private key can open the box, so opening it is the whole
proof. The nonce lives inside the token the relay signed rather than in a table,
which keeps the handshake stateless. One account streams on one device at a
time: logging in elsewhere moves the account and signs the old device out.

## Sending a message

Both ends derive the same AES-GCM key by ECDH over their two identity keys, with
an HKDF label built from both addresses sorted — so a key is good for exactly
one pair of people and nothing else. The sender encrypts, POSTs the ciphertext,
and that's it.

```
you ──encrypt──► POST /messages ──► pending_messages ──NOTIFY──► SSE ──► them
                                           ▲                             │
                                           └───── DELETE /messages/:id ───┘
```

The relay writes the row, announces its id on a Postgres `LISTEN/NOTIFY`
channel, and whichever pod holds the recipient's SSE stream loads it and pushes
it down. The client acks by deleting it and the row is gone. If nobody's
listening, the row waits and a web push nudges the recipient. No history is kept
server-side, so there's nothing to hand over later.

Locally, messages are encrypted at rest too, under a key the identity derives
against itself. Logging out drops that key, which is what makes logging out mean
something.

## Running it

```sh
npm ci
npm run db:start              # postgres, via compose.dev.yml
npm run db:generate-types     # prisma client (gitignored, so this is required)
npm run db:apply-migrations
npm run dev:relay             # :5200
npm run dev:client            # :5100
npm run test                  # flow tests, against that same postgres
```

Config is read straight from the environment, and nothing in the code loads a
`.env` file — export the vars however you normally would. `JWT_SECRET` and
`DATABASE_URL` are the only two without defaults. The VAPID keys are optional;
leave them unset and push notifications just stay off.

| | |
|---|---|
| `src/client` | React 19 PWA — Dexie for local storage, Tailwind, wouter |
| `src/relay`  | h3 server, Prisma, Postgres. Stateless apart from the queue |
| `src/shared` | crypto, mnemonics, and the wire protocol both sides validate against |
| `src/test`   | end-to-end flow tests that drive the real client against the real relay |

The client deploys to GitHub Pages; the relay ships as a container image built
in CI.

## Things it doesn't do

- **It hasn't been audited.** The primitives are WebCrypto and `@noble`, but the
  protocol around them is homegrown. Treat it accordingly.
- **It doesn't hide metadata.** The relay can see which addresses talk to each
  other, and when. It just can't see what they said.
- **It doesn't sync history.** Messages live on the device that received them,
  which is also why one account streams on one device at a time.
- **Large payloads are slow.** Base58 encoding is quadratic, so a big attachment
  costs real time on both ends. Known, not yet fixed.
