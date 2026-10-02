import type { IncomingMessage, ServerResponse } from "node:http";
import { notesMock } from "./notes.ts";
import { overviewMock } from "./overview.ts";
import { checkupsMock, growthMock } from "./health.ts";
import { libraryMock } from "./library.ts";
import { logsModule, logTypesModule } from "./logs.ts";

/**
 * FAKE API modules for `npm run dev:mock` (local UI work and e2e only, never in a build).
 * Each feature area adds one file in this folder and one line in MOCK_MODULES.
 * Data must be synthetic only (fixtures rules: 테스트아이, 2020-01-15, 교사A, 친구A/B).
 */
export interface MockModule {
  /** Path prefix under the site root, e.g. "/api/notes". */
  prefix: string;
  handle: (req: IncomingMessage, res: ServerResponse, ctx: MockContext) => void | Promise<void>;
}

export interface MockContext {
  /** Path after the prefix, without the query string (e.g. "/2020-03-02"). */
  subPath: string;
  query: URLSearchParams;
  authed: boolean;
  send: (status: number, body?: unknown, headers?: Record<string, string>) => void;
  readJson: () => Promise<unknown>;
}

export const MOCK_MODULES: MockModule[] = [
  notesMock,
  overviewMock,
  libraryMock,
  checkupsMock,
  growthMock,
  logsModule,
  logTypesModule,
];
