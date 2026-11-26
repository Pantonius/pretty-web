# pretty-web

A collaborative Typst editor for the web: a file explorer on the left, the Typst
source in the middle, and a live preview of the compiled document on the right.

Everything runs in the browser — the Typst compiler itself is a WebAssembly
module, so each collaborator typesets the shared document locally while Yjs
keeps everyone's edits, cursors, and selections in sync through a small
WebSocket server.

## Features

- Real-time collaborative editing (CRDT-based, works offline and reconnects)
- File explorer with create / rename / delete for multi-file projects
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

- **Shared state** lives in one Yjs document per room. Files are a `Y.Map<Y.Text>`
  (`path → source`), so renames and inserts are CRDT operations, not filesystem
  calls. The editor binds each file's `Y.Text` to CodeMirror with `y-codemirror.next`.
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

## Limitations

- No authentication or access control — anyone with the room URL can edit.
- Room snapshots are plain files, not a proper database.
- Renames copy the text rather than the edit history.
- The browser engine needs WebAssembly JSPI (current Chromium) or module
  workers (fallback), so very old browsers are not supported.
