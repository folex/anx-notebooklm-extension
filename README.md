# NotebookLM extension for Anx Reader

Connect Anx directly to Google NotebookLM, without a custom server or a running computer.

This repository contains a separately installable JavaScript extension, not reader source code. Anx supplies the extension runtime and permission-controlled host API. Network cookies stay in Android WebView's cookie store and are attached by the native HTTP transport; they never enter the tool result or extension package.

Implementation is in progress. The Android Google sign-in flow needs verification on a real device; packaged builds and fixture tests alone do not prove that Google accepts an embedded browser sign-in.
