// Starts the Vite dev server with the FAKE mock session API enabled (PIN "0000").
// See vite-plugins/mock-api.ts. Never used for production builds.
process.env.VITE_MOCK_API = "1";
const { createServer } = await import("vite");
// HMR 끔: 오프라인 e2e(context.setOffline)에서 vite 클라이언트가 연결 끊김을 보고 페이지를 다시 불러오지 않게 한다.
const server = await createServer({ server: { hmr: false } });
await server.listen();
server.printUrls();

export {};
