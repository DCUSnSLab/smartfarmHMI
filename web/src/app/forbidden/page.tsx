/** 권한 없음 안내 (FR-31) — design-change-spec §3.1 화면 3종 중 하나. */

import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6">
      <h1 className="text-2xl font-extrabold text-status-warningDark">접근 권한이 없습니다</h1>
      <p className="text-14 font-semibold text-muted">
        이 화면을 사용할 권한이 없어요. 관리자에게 권한을 요청하세요.
      </p>
      <Link href="/" className="mt-2 rounded-xl bg-primary px-5 py-2.5 text-14 font-extrabold text-white">
        대시보드로 돌아가기
      </Link>
    </main>
  );
}
