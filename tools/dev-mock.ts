// Starts the Vite dev server with the FAKE mock session API enabled (PIN "0000").
// See vite-plugins/mock-api.ts. Never used for production builds.
process.env.VITE_MOCK_API = "1";
const { createServer } = await import("vite");
const server = await createServer();
await server.listen();
server.printUrls();

export {};
