import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { assertConfigLimits } from "./utils/validation.js";
import { createMcpServer } from "./server.js";

const cfg = loadConfig();
assertConfigLimits(cfg);
const server = createMcpServer(cfg);
const transport = new StdioServerTransport();
await server.connect(transport);
