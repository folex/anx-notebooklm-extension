# NotebookLM extension for Anx Reader

Connect Anx directly to Google NotebookLM, without a custom server or a running computer.

Requires the Personal.23 extension host from [folex/anx-reader](https://github.com/folex/anx-reader). This preview uses the NotebookLM web protocol adapted from notebooklm-mcp-cli 0.16.1; it is not an official Google API integration. Google can change or reject it.

## Install

1. Install the Personal.23 APK over the existing Personal app.
2. Save `NotebookLM-0.1.0.anxplugin` on the phone.
3. Open **Settings → AI → Extensions → Install extension**, select the file and review its permissions.
4. Press **Sign in**, complete Google sign-in and press **Done — return to Anx**.
5. Open the AI chat. Ask it to list your NotebookLM notebooks or upload the current chapter.

Android Google sign-in has not yet been verified on a device. Google may refuse the embedded sign-in screen. An authenticated live notebook-list and question request passed using an existing desktop session; that does not prove Android login works.

## AI tools

| Tool | Use |
|---|---|
| `notebooks` | List up to 100 notebooks. |
| `upload` | Upload the open chapter/page or a complete library EPUB, creating a notebook or using an existing one. |
| `ask` | Ask a question grounded in a notebook; return the final answer and citation source IDs. |
| `audio` | Request an audio overview, with language and focus. |
| `status` | Check existing Studio artifacts and whether audio is ready. |
| `download` | Save completed audio directly on the phone. Open it from the extension's **Downloaded audio** list. |

Examples:

- “Upload this chapter to a new NotebookLM notebook.”
- “Ask that notebook to explain the grammar in the chapter, with examples.”
- “Make a Spanish audio overview of that notebook, focusing on unfamiliar vocabulary.”
- “Check whether the audio is ready and download it.”

Uploads and audio creation require an explicit user request. A stable `operationId` records each mutation. Concurrent retries cannot create duplicates for the same receipt. If a connection fails after an operation starts, the plugin returns an uncertain result and any confirmed notebook/source IDs; it does not blindly repeat it. Check Google before requesting a new operation.

Whole-book EPUB uploads include spoilers. Whole PDFs and OCR are not supported; the currently open text-based PDF page can be uploaded. EPUB export removes generated hints and follows the book's spine order. Each question is independent; follow-up questions must include the relevant context. Google source-processing delays and account quotas still apply.

## Permissions and session

The plugin requests `books.read`, `network` and `ui`; it does not request book editing. Anx validates declared HTTPS origins at each network request and redirect. Authentication-only origins are separate from origins the plugin may request through its API.

The Google session stays in Android WebView's cookie store. Native HTTP attaches cookies for the destination; raw cookies are not exposed to JavaScript or AI tool results. NotebookLM's page-level CSRF/session fields are used internally by the protocol. A session fingerprint scopes operation receipts and detects changes before NotebookLM POST requests. This preview uses the current browser session/default Google account; it is not a multi-account manager.

Downloaded audio remains in Anx's private app directory. An external audio player receives temporary read access through Android FileProvider. Neither credentials nor books are included in this repository or the plugin ZIP.

## Build and checks

```sh
node --test plugin.test.cjs
python3 build.py
```

The ZIP contains only `manifest.json`, `plugin.js`, `LICENSE` and this README. No Python runtime or full CLI is shipped to the phone. The fixture suite covers response framing, final-answer filtering, source IDs, notebook listing, mutation receipts, concurrency and ambiguous failures. Real uploads, audio generation and Android execution are not yet verified.

Protocol attribution and the upstream MIT license are in [THIRD_PARTY_NOTICE.md](THIRD_PARTY_NOTICE.md).
