// The language server in its own Node process, on the desktop
import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import { startServer } from "./server.js";

startServer(createConnection(ProposedFeatures.all));
