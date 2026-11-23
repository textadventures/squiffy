// The language server in a Web Worker, on vscode.dev and github.dev
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from "vscode-languageserver/browser";
import { startServer } from "./server.js";

declare const self: DedicatedWorkerGlobalScope;

startServer(createConnection(new BrowserMessageReader(self), new BrowserMessageWriter(self)));
