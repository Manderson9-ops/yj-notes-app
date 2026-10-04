import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// 느린 PC·병렬 실행에서 지연 로딩 화면(lazy 라우트)이 1초 안에 안 뜨는 일이 있어 비동기 대기를 넉넉히 둔다.
configure({ asyncUtilTimeout: 5000 });
