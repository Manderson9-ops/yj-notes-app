-- 전역 시도 집계와 30일 정리가 at 으로 훑는다 (T-06 검토 반영)
CREATE INDEX IF NOT EXISTS idx_auth_attempt_at ON auth_attempt(at, ok);
