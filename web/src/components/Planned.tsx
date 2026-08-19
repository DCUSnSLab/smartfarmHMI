"use client";

/**
 * 「개발 예정」 표준 표시 — 아직 구현되지 않은 기능의 자리를 명시한다.
 *
 * UI/UX 를 먼저 갖추고 기능을 나중에 채우는 방식이므로, 사용자가 "고장"과
 * "미구현"을 구분할 수 있어야 한다. basis 에 근거(FR·증분·OPN)를 남겨
 * 추후 어느 작업에서 채워질지 추적 가능하게 한다.
 */

export function PlannedChip({ basis }: { basis?: string }) {
  return (
    <span
      title={basis ? `개발 예정 — ${basis}` : "개발 예정"}
      className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-0.5 text-11 font-extrabold text-gray-500"
    >
      개발 예정{basis ? ` · ${basis}` : ""}
    </span>
  );
}

/** 섹션 전체가 미구현일 때 — 골격 대신 안내 박스 */
export function PlannedBox({
  feature, basis, children,
}: {
  feature: string;
  basis: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-14 font-extrabold text-gray-500">{feature}</span>
        <PlannedChip basis={basis} />
      </div>
      {children && (
        <div className="text-12.5 font-semibold leading-relaxed text-muted">{children}</div>
      )}
    </div>
  );
}

/** 골격 UI 는 보여주되 비활성 — 디자인 구성을 유지하면서 미구현임을 표시 */
