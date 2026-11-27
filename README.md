# pretty-web

A collaborative Typst editor for the web: a file explorer on the left, the Typst
source in the middle, and a live preview of the compiled document on the right.

Everything runs in the browser — the Typst compiler itself is a WebAssembly
module, so each collaborator typesets the shared document locally while Yjs
keeps everyone's edits, cursors, and selections in sync through a small
WebSocket server.

## Features

- Real-time collaborative editing (CRDT-based, works offline and reconnects)
- File explorer with folders and create / rename / delete for multi-file projects
- Upload assets (images, CSV, fonts, …) via button or drag & drop — they are
  synced to every collaborator and readable from Typst (`#image(...)`, `#csv(...)`)
- Split view: Typst source (CodeMirror 6 with Typst highlighting) and live preview
- Typst compiled client-side via [typst-wasm](https://github.com/typst-wasm/typst-wasm),
  including embedded default fonts (Libertinus Serif, New Computer Modern, DejaVu Sans Mono)
- Compiler diagnostics panel with error/warning locations
- PDF export
- Multiple rooms: append `?room=my-room` to the URL
- Works offline: documents persist in IndexedDB and re-attach when you return

## Getting started

```sh
npm install
npm run dev
```

This starts two processes:

- the collaboration server on `ws://127.0.0.1:1234`
- the Vite dev server on `http://localhost:5173`

Open `http://localhost:5173` in two browser windows (or add `?room=whatever`
to both URLs) and start typing — edits, cursors, and selections sync instantly,
and the preview recompiles a few hundred milliseconds after you stop typing.

## Folders and assets

Projects are organized by path: `sections/intro.typ` shows up inside a
`sections/` folder automatically. Use the **+** button in the sidebar to create
a file or a folder at any depth (e.g. `assets/images`), and rename or delete
folders like files — renaming a folder rewrites all paths inside it.

Upload assets with the **⇪** button or by dropping files onto the file list.
Text-like files (`.typ`, `.csv`, `.json`, `.md`, …) become collaborative text
files you can edit in place; everything else (`.png`, `.jpg`, `.ttf`, …) is
stored as a binary asset and synced to every collaborator. Uploaded files are
added to the Typst compiler's virtual filesystem, so documents can reference
them directly:

```typst
#image("assets/photo.png")
#table(columns: 2, ..csv("data/scores.csv").flatten())
```

Selecting an image asset shows a preview in the editor pane; any asset can be
downloaded from there.

`node scripts/smoke-assets.mjs` verifies image and CSV resolution in the
compiler, and `node scripts/smoke-asset-sync.mjs` verifies two clients sync
assets and folders through the collab server.

## Architecture

```
├── client/          React + Vite frontend
│   └── src/
│       ├── collab.ts        Yjs document, WebSocket provider, awareness
│       ├── compiler.ts      typst-wasm wrapper (fonts, project sync, compile)
│       ├── typst-lang.ts    CodeMirror syntax highlighting for Typst
│       └── components/      FileExplorer, CodeEditor, Preview
└── server/          Collaboration server (no Typst, just sync)
    └── src/index.mjs       y-protocols over WebSockets + snapshot persistence
```

- **Shared state** lives in one Yjs document per room. Text files are a
  `Y.Map<Y.Text>` (`path → source`), binary assets a `Y.Map<Uint8Array>`, and
  empty folders a `Y.Map` of path markers — renames and inserts are CRDT
  operations, not filesystem calls. The editor binds each file's `Y.Text` to
  CodeMirror with `y-codemirror.next`.
- **The server** (`server/src/index.mjs`) implements the y-websocket sync and
  awareness protocols with `ws` and `y-protocols`, relays updates between
  clients, and snapshots each room to `.data/<room>.ydoc` (one second after the
  last edit) so documents survive restarts.
- **Compilation** happens in each browser: `compiler.ts` mirrors the Yjs file map
  into the Typst engine's virtual filesystem and compiles `main.typ` (or the
  open file) to SVG. Each collaborator sees a preview of the merged document.

## Configuration

| Variable           | Where   | Default                        | Meaning                                |
| ------------------ | ------- | ------------------------------ | -------------------------------------- |
| `PORT`             | server  | `1234`                         | Collaboration server port              |
| `HOST`             | server  | `127.0.0.1`                    | Bind address (`0.0.0.0` for Docker)    |
| `DATA_DIR`         | server  | `<repo>/.data`                 | Room snapshot directory                |
| `VITE_COLLAB_URL`  | client  | same host, `/collab` path      | WebSocket URL of the collab server     |
| `AUTH_MODE`        | server  | `none`                         | `none`, `oidc`, or `proxy` (see below) |
| `AUTH_ISSUER`      | server  | —                              | OIDC issuer URL (oidc mode)            |
| `AUTH_AUDIENCE`    | server  | —                              | Expected `aud` claim (oidc mode)       |
| `STATIC_DIR`       | server  | —                              | Serve a built client (e.g. `client/dist`) |
| `VITE_AUTH_MODE`   | client  | `none`                         | `none`, `oidc`, or `proxy`             |
| `VITE_OIDC_ISSUER` | client  | —                              | authentik provider URL (oidc mode)     |
| `VITE_OIDC_CLIENT_ID` | client | —                            | OAuth2 client id (oidc mode)           |
| `VITE_OIDC_REDIRECT_URI` | client | current origin + base     | OAuth redirect URI                     |

## Authentication (authentik)

The editor integrates with [authentik](https://goauthentik.io) in two ways, so
users can log in through any upstream authentik supports (local, LDAP, SAML
federation, social logins, …):

### OIDC mode (native)

Create an OAuth2/OIDC provider for the app in authentik (application type:
*Confidential* or *Public*; for public browser clients use **public** with PKCE).
Then set, for the server:

```sh
AUTH_MODE=oidc
AUTH_ISSUER=https://auth.example.com/application/o/pretty-web/
AUTH_AUDIENCE=<client id>   # optional but recommended
```

and for the client build:

```sh
VITE_AUTH_MODE=oidc
VITE_OIDC_ISSUER=https://auth.example.com/application/o/pretty-web/
VITE_OIDC_CLIENT_ID=<client id>
```

The browser does an authorization-code + PKCE flow against authentik; the
WebSocket handshake must carry the access token, and the server verifies its
RS256 signature against authentik's published JWKS (via OIDC discovery) plus
`iss`/`aud`/`exp` claims. Unauthenticated peers are rejected at the socket level,
so a leaked room URL is not enough to edit. `GET /me?token=…` returns the
verified identity.

### Proxy mode (any authentik protocol)

Put the app behind an authentik **proxy provider** (embedded outpost or reverse
proxy with forward auth). The outpost authenticates users with any protocol
authentik offers and injects `X-authentik-*` headers; the server trusts them and
exposes `GET /me`, which feeds identity into presence. Configure:

```sh
AUTH_MODE=proxy
STATIC_DIR=client/dist   # optional: serve the built client from the same origin
```

`VITE_AUTH_MODE=proxy` on the client. In this mode the *server must only be
reachable through the outpost* — the header is the identity, so direct access
would bypass login. `AUTH_PROXY_SECRET` (checked against `x-authentik-proxy-secret`)
adds a shared-secret check for deployments where the outpost can set a custom header.

Example nginx fronting (forward auth pattern):

```nginx
location / {
    auth_request /outpost.goauthentik.io/auth;
    proxy_pass http://127.0.0.1:1234;          # collab server (static + ws)
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;    # WebSocket passthrough
    proxy_set_header Connection "upgrade";
    proxy_set_header X-authentik-username $authentik_username;
    proxy_set_header X-authentik-name $authentik_name;
    proxy_set_header X-authentik-email $authentik_email;
    proxy_set_header X-authentik-groups $authentik_groups;
}
```

### Smoke test

`node scripts/smoke-auth.mjs` runs a mock OIDC issuer (RSA-signed JWTs, discovery
+ JWKS) and asserts: valid tokens connect, expired/tampered/wrong-issuer/missing
tokens get 401, and proxy-header identity works — across all three server modes.

The server validates *authentication*; it does not yet bind awareness names to
verified identities (a signed-in user could still claim a different display name).


In development the Vite dev server proxies `/collab/*` to the local collab
server. For production, build the client (`npm run build`) and either reverse-proxy
`/collab` to the collab server or set `VITE_COLLAB_URL` to its `wss://` address.

## GitHub Pages

A GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) builds the
client and deploys it to Pages on every push to `main` (site:
`https://<owner>.github.io/pretty-web/`). One-time setup in the repository:
*Settings → Pages → Build and deployment → Source: **GitHub Actions***.

Pages only hosts the frontend — there is no collaboration server on the JAMstack,
so on Pages the editor runs in **solo mode**: everything compiles locally, work is
saved to IndexedDB, and rooms are per-browser. To collaborate, run the collab
server somewhere with WebSocket support and build with
`VITE_COLLAB_URL=wss://your-server`.

Note: the in-browser engine prefers WebAssembly JSPI (current Chromium) and falls
back to a web worker; GitHub Pages cannot send the cross-origin isolation headers
needed for `SharedArrayBuffer`, so the worker fallback may not compile there.

## Docker

The `Dockerfile` builds a single image that serves the compiled client, the
collaboration WebSocket server, and the `/me` identity endpoint on one port
(the server serves `client/dist` via `STATIC_DIR`, so no separate frontend
hosting is needed). Documents persist to the `/app/.data` volume:

```sh
docker compose up --build
# open http://localhost:1234
```

Client auth is baked in at build time (Vite env vars), while server auth is
configured at runtime. Set them in the environment or a `.env` file next to
`docker-compose.yml` — for authentik OIDC:

```sh
VITE_AUTH_MODE=oidc
VITE_OIDC_ISSUER=https://auth.example.com/application/o/pretty-web/
VITE_OIDC_CLIENT_ID=pretty-web
AUTH_MODE=oidc
AUTH_ISSUER=https://auth.example.com/application/o/pretty-web/
# AUTH_AUDIENCE=...          # optional expected aud claim
# AUTH_PROXY_SECRET=...      # proxy mode shared secret
```

Behind a reverse proxy, terminate TLS there and forward everything to the
container, including the `Upgrade`/`Connection` headers for the WebSocket.
In `proxy` auth mode the authentik outpost must sit in front so the
`X-authentik-*` headers reach the server — never expose the container
straight to the internet in that mode.

## Limitations

- In `none` auth mode there is no access control — anyone with the room URL can
  edit. Enable `oidc` or `proxy` mode to require authentik.
- Room snapshots are plain files, not a proper database.
- Renames copy the text rather than the edit history.
- Uploaded assets are re-sent to the compiler when they change; very large
  binary assets increase memory use in every collaborator's browser.
- The browser engine needs WebAssembly JSPI (current Chromium) or module
  workers (fallback), so very old browsers are not supported.
