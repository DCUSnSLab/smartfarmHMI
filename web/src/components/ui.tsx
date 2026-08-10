"use client";

/**
 * 공용 UI 프리미티브 — 디자인 전달본 토큰 기반 (docs/design/README.md 디자인 토큰).
 * 상태는 색 + 도형·문자 병기 (비기능 §5 접근성: 색 단독 구분 금지).
 */

import { CSSProperties, RefObject, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// 헤더 컨트롤 공통 — 높이·글자·정렬 통일. 터치 기기에서만 40px 로 키운다 (비기능 §5)
export const CONTROL =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl text-13.5 [@media(pointer:coarse)]:h-10";

/** 아이콘 전용 정사각 컨트롤 */
export const CONTROL_ICON = `${CONTROL} w-9 justify-center [@media(pointer:coarse)]:w-10`;

/**
 * 팝오버 위치 — 트리거 오른쪽에 맞추되 화면을 벗어나면 옆으로 밀어넣는다.
 * 특정 폭에서 갑자기 전체 폭으로 바뀌지 않고 연속적으로 이동·축소된다.
 */
export function useAnchoredPanel(open: boolean, maxWidth: number) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [style, setStyle] = useState<CSSProperties>();

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const w = Math.min(maxWidth, window.innerWidth - margin * 2);
    const left = Math.max(margin, Math.min(r.right - w, window.innerWidth - w - margin)) - r.left;
    // 값이 같으면 상태를 갱신하지 않는다 — 매 렌더 재계산이 무한 루프가 되지 않게
    setStyle((prev) =>
      prev?.left === left && prev?.width === w ? prev : { left, width: w },
    );
  }, [maxWidth]);

  // 열린 동안 매 렌더 재계산 — 글자 크기 변경처럼 앵커가 움직이는 경우를 잡는다.
  // 이펙트는 자식 → 부모 순이라 즉시 계산은 부모(PrefsProvider)의 DOM 변경 전에
  // 돌 수 있다. 다음 프레임에 한 번 더 재서 최종 레이아웃을 반영한다.
  useEffect(() => {
    if (!open) return;
    place();
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  });

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, place]);

  // 닫힐 때 위치를 버린다 — 닫힌 동안 레이아웃이 바뀌면(리사이즈·글자 크기) 옛 좌표가
  // 남아 다시 열 때 한 프레임 엉뚱한 자리에 보인다. 리스너도 닫힌 동안은 없다.
  useEffect(() => {
    if (!open) setStyle(undefined);
  }, [open]);

  // 위치 계산은 렌더 후라 첫 프레임에 잘못된 자리에 보인다 — 계산 전까지 감춘다
  return { anchorRef, style, unplaced: !style };
}

/** 외부 클릭·Esc 로 닫기 (라이트 디스미스) — 헤더 팝오버 공용 */
export function useLightDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, onClose]);
}

export const SEV_STYLE: Record<string, { dot: string; text: string; bg: string; label: string }> = {
  ok: { dot: "bg-status-ok", text: "text-primary-dark", bg: "bg-primary-bg", label: "정상" },
  caution: { dot: "bg-status-caution", text: "text-status-cautionDark", bg: "bg-status-caution/10", label: "주의" },
  warning: { dot: "bg-status-warning", text: "text-status-warningDark", bg: "bg-status-warning/10", label: "경고" },
  info: { dot: "bg-status-info", text: "text-status-infoDark", bg: "bg-status-info/10", label: "정보" },
};

export const CONN_STYLE: Record<string, { label: string; sev: string }> = {
  online: { label: "정상", sev: "ok" },
  degraded: { label: "응답 지연", sev: "caution" },
  offline: { label: "오프라인", sev: "warning" },
};

export function Card({
  children, className = "", onClick,
}: {
  children: React.ReactNode; className?: string; onClick?: () => void;
}) {
  const base = `rounded-2xl bg-white p-5 shadow-sm ${className}`;
  return onClick ? (
    <button onClick={onClick} className={`${base} text-left transition hover:shadow-md`}>
      {children}
    </button>
  ) : (
    <div className={base}>{children}</div>
  );
}

export function SectionTitle({
  title, sub, right,
}: {
  title: string; sub?: string; right?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-2">
      <h3 className="text-15 font-extrabold">{title}</h3>
      {sub && <span className="text-12.5 font-semibold text-muted">· {sub}</span>}
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

export function StatusDot({ sev, label }: { sev: string; label?: string }) {
  const s = SEV_STYLE[sev] ?? SEV_STYLE.info;
  return (
    <span className={`inline-flex items-center gap-1.5 text-12.5 font-bold ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {label ?? s.label}
    </span>
  );
}

/** KPI 타일 — 디자인 Fleet KPI 카드 (강조 수치 22px+, 비기능 §5) */
export function KpiTile({
  label, value, unit, detail, tone = "default",
}: {
  label: string; value: React.ReactNode; unit?: string;
  detail?: React.ReactNode; tone?: "default" | "warning" | "caution";
}) {
  const valueColor =
    tone === "warning" ? "text-status-warningDark"
    : tone === "caution" ? "text-status-cautionDark" : "";
  return (
    <Card>
      <div className="text-13 font-bold text-gray-500">{label}</div>
      <div className={`mt-1 text-26 font-extrabold leading-tight ${valueColor}`}>
        {value}
        {unit && <span className="ml-0.5 text-13 font-bold text-muted">{unit}</span>}
      </div>
      {detail && <div className="mt-1 text-12 font-semibold text-muted">{detail}</div>}
    </Card>
  );
}

/** 수평 게이지 — 탱크 수위·적정범위 대비 (디자인 환경 상태·탱크 카드) */
export function Gauge({
  value, min = 0, max = 100, okMin, okMax, unit = "", compact = false,
}: {
  value: number | null; min?: number; max?: number;
  okMin?: number | null; okMax?: number | null; unit?: string; compact?: boolean;
}) {
  if (value == null) {
    return <div className="h-2 w-full rounded-full bg-gray-100" />;
  }
  const span = max - min || 1;
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100));
  const inRange =
    (okMin == null || value >= okMin) && (okMax == null || value <= okMax);
  const bar = inRange ? "bg-status-ok" : "bg-status-caution";

  // 적정범위 밴드 (있을 때만)
  const bandLeft = okMin != null ? Math.max(0, ((okMin - min) / span) * 100) : null;
  const bandRight = okMax != null ? Math.min(100, ((okMax - min) / span) * 100) : null;

  return (
    <div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-100">
        {bandLeft != null && bandRight != null && (
          <div
            className="absolute inset-y-0 bg-primary-bg"
            style={{ left: `${bandLeft}%`, width: `${Math.max(0, bandRight - bandLeft)}%` }}
          />
        )}
        <div className={`relative h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <div className="mt-1 flex justify-between text-11 font-semibold text-muted">
          <span>
            {okMin != null && okMax != null ? `적정 ${okMin}~${okMax}${unit}` : `${min}~${max}${unit}`}
          </span>
          <span className={inRange ? "" : "text-status-cautionDark"}>
            {inRange ? "적정" : "범위 밖"}
          </span>
        </div>
      )}
    </div>
  );
}

export interface ChartSeries {
  name: string;
  color: string;
  unit?: string;
  points: { ts: string; value: number }[];
}

/**
 * 라인 차트 — 의존성 없이 SVG (디자인의 단순 추이 그래프).
 *
 * **계열별 독립 축**: 온도(℃)와 습도(%)처럼 값 범위가 다른 계열을 함께 그릴 때
 * 축을 공유하면 한쪽이 위아래로 붙어 추이를 읽을 수 없다. 각 계열을 자기
 * 최소·최대로 정규화하고, 첫 계열은 좌축·둘째 계열은 우축에 눈금을 표시한다.
 * (SVG 는 preserveAspectRatio="none" 으로 늘어나므로 축 라벨은 HTML 로 배치)
 */
export function LineChart({ series, height = 180 }: { series: ChartSeries[]; height?: number }) {
  const usable = series.filter((s) => s.points.length > 0);
  if (usable.length === 0) {
    return (
      <div className="flex items-center justify-center text-13 font-semibold text-muted" style={{ height }}>
        데이터가 없어요
      </div>
    );
  }

  // 계열별 독립 스케일
  const scaled = usable.map((s) => {
    const vals = s.points.map((p) => p.value);
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const pad = (mx - mn) * 0.15 || Math.max(Math.abs(mx) * 0.05, 0.5);
    return { ...s, lo: mn - pad, hi: mx + pad };
  });

  const W = 100;
  const H = 100;
  const path = (s: (typeof scaled)[number]) => {
    const n = s.points.length;
    return s.points
      .map((p, i) => {
        const x = n === 1 ? W / 2 : (i / (n - 1)) * W;
        const y = H - ((p.value - s.lo) / (s.hi - s.lo || 1)) * H;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  };

  const ticks = (s: (typeof scaled)[number]) => {
    const step = (s.hi - s.lo) / 4;
    const digits = s.hi - s.lo < 5 ? 1 : 0;
    return [4, 3, 2, 1, 0].map((i) => (s.lo + step * i).toFixed(digits));
  };

  const left = scaled[0];
  const right = scaled.length > 1 ? scaled[1] : null;
  const axisText = (s: (typeof scaled)[number]) =>
    `${s.name}${s.unit ? ` (${s.unit})` : ""}`;

  const timeAxis = scaled.reduce((a, b) => (b.points.length > a.points.length ? b : a)).points;
  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      {/* 범례 — 어느 계열이 어느 축인지 명시 */}
      <div className="mb-2 flex flex-wrap gap-3">
        {scaled.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1.5 text-12 font-bold text-gray-600">
            <span className="h-2 w-3 rounded-sm" style={{ background: s.color }} />
            {s.name}
            {s.unit && <span className="font-semibold text-muted">({s.unit})</span>}
            {scaled.length > 1 && i < 2 && (
              <span className="rounded bg-gray-100 px-1 text-10.5 font-extrabold text-gray-500">
                {i === 0 ? "좌축" : "우축"}
              </span>
            )}
          </span>
        ))}
      </div>

      <div className="flex gap-1.5">
        {/* 좌축 눈금 */}
        <div
          className="flex w-9 flex-col justify-between text-right text-10.5 font-semibold"
          style={{ height, color: left.color }}
        >
          {ticks(left).map((v, i) => <span key={i}>{v}</span>)}
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
          style={{ height, width: "100%" }}
          role="img"
          aria-label={`추이 그래프 — ${scaled.map(axisText).join(", ")}`}
        >
          {[0, 25, 50, 75, 100].map((y) => (
            <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="#F2F4F6" strokeWidth="0.4" />
          ))}
          {scaled.map((s) => (
            <path
              key={s.name} d={path(s)} fill="none" stroke={s.color}
              strokeWidth="0.9" vectorEffect="non-scaling-stroke" strokeLinejoin="round"
            />
          ))}
        </svg>

        {/* 우축 눈금 (둘째 계열이 있을 때만) */}
        {right && (
          <div
            className="flex w-9 flex-col justify-between text-10.5 font-semibold"
            style={{ height, color: right.color }}
          >
            {ticks(right).map((v, i) => <span key={i}>{v}</span>)}
          </div>
        )}
      </div>

      {timeAxis.length > 1 && (
        <div
          className="mt-1 flex justify-between text-11 font-semibold text-muted"
          style={{ paddingLeft: "2.625rem", paddingRight: right ? "2.625rem" : 0 }}
        >
          <span>{timeLabel(timeAxis[0].ts)}</span>
          <span>{timeLabel(timeAxis[Math.floor(timeAxis.length / 2)].ts)}</span>
          <span>{timeLabel(timeAxis[timeAxis.length - 1].ts)}</span>
        </div>
      )}
    </div>
  );
}

/** 모달 셸 — 센서 상세·수동 제어·임무 추가 공용 (디자인 모달 5종) */
export function Modal({
  title, sub, onClose, children, footer, wide = false,
}: {
  title: string; sub?: string; onClose: () => void;
  children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[85vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-baseline gap-2">
          <h3 className="text-18 font-extrabold">{title}</h3>
          {sub && <span className="text-12.5 font-semibold text-muted">{sub}</span>}
          <button
            onClick={onClose} aria-label="닫기"
            className="ml-auto text-20 leading-none text-gray-400"
          >
            ×
          </button>
        </div>
        {children}
        {footer && <div className="mt-5">{footer}</div>}
      </div>
    </div>
  );
}

export const SENSOR_META: Record<string, { name: string; unit: string; color: string }> = {
  temperature: { name: "온도", unit: "℃", color: "#F04452" },
  humidity: { name: "습도", unit: "%", color: "#3182F6" },
  ec: { name: "양분(EC)", unit: "", color: "#00A05A" },
  co2: { name: "CO₂", unit: "ppm", color: "#8B95A1" },
  illuminance: { name: "조도", unit: "klx", color: "#F5A623" },
  power: { name: "소모전력", unit: "kW", color: "#1B64DA" },
  water_level: { name: "탱크 수위", unit: "%", color: "#0E9AA0" },
};

export const TANK_LABEL: Record<string, string> = {
  nutrient: "양액", water: "급수", pesticide: "방재액", cleaning: "세정액",
};

/** 임무 진행 단계 (§4.2 `phase`). 오류는 축이 달라 `robot.error` 로 따로 그린다 */
export const PHASE_LABEL: Record<string, string> = {
  idle: "대기", moving: "이동 중", working: "작업 중", charging: "충전 중",
};

export interface NavItemData {
  key: string;
  label: string;
  active: boolean;
  href?: string;             // 이동형 (스코프 스위처·상세 탭)
  onSelect?: () => void;     // 선택형 (통계 농장 필터 — 이동하지 않는다)
  lead?: React.ReactNode;    // 라벨 앞 표시 (상태 점 등)
  trail?: React.ReactNode;   // 라벨 뒤 표시 (미확인 수·유형 배지 등)
}

/** 이동형·선택형을 같은 모양으로 — href 가 있으면 Link, 없으면 button */
export function NavItemLink({
  item, className, onDone, children,
}: {
  item: NavItemData; className: string; onDone?: () => void; children: React.ReactNode;
}) {
  if (item.href) {
    return (
      <Link href={item.href} onClick={onDone} className={className}>{children}</Link>
    );
  }
  return (
    <button onClick={() => { item.onSelect?.(); onDone?.(); }} className={className}>
      {children}
    </button>
  );
}

/**
 * 좁은 폭에서 목록을 접는 네비게이션 — 현재 항목만 보이고, 누르면 전체가 펼쳐진다.
 *
 * 스코프 스위처·상세 탭은 헤더와 함께 **고정 영역**이라, 줄바꿈을 허용하면 농장·탭이
 * 늘어난 만큼 높이가 커지고 본문이 영구히 밀린다. 가로 스크롤은 모바일에서 세로
 * 스크롤과 제스처가 부딪히고 스크롤바가 보이지 않아 있다는 걸 알기 어렵다.
 * 접으면 항목이 몇 개든 **높이가 한 줄로 고정**된다 (헤더의 햄버거와 같은 방식).
 *
 * 넓은 폭에서는 이 컴포넌트가 숨고 각 네비의 원래 나열이 그대로 보인다.
 */
export function NavDropdown({
  items, ariaLabel, className = "",
}: {
  items: NavItemData[];
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useLightDismiss(open, boxRef, () => setOpen(false));

  // 이동해도 컴포넌트가 살아 있어 스스로 닫히지 않는다 — 경로가 바뀌면 닫는다
  useEffect(() => setOpen(false), [pathname]);

  const current = items.find((i) => i.active) ?? items[0];
  if (!current) return null;

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      {/* 폭을 내용에 맞추지 않고 **가득 채운다**. 작은 상자를 얹으면 라벨 길이에 따라
          화면마다 크기가 달라져 자리가 흔들리고, 흰 바 위에 뜬 것처럼 보인다.
          바탕은 바와 같은 흰색으로 두고, **초록 테두리로 「선택됨」**을 표시한다 —
          넓은 폭에서 현재 농장이 초록으로 칠해지는 것과 같은 신호라 색감이 튀지 않는다.
          라벨은 검정 — 농장·탭 이름은 읽어야 할 값이라 본문색이 가장 잘 읽힌다. */}
      <div className="px-6 py-2">
        <button
          onClick={() => setOpen(!open)}
          // listbox 로 알리면 자식이 option 이어야 한다 — 여기 항목은 링크·버튼이라
          // 상태(펼침 여부)만 전한다
          aria-label={ariaLabel} aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-xl border border-primary bg-white px-3 py-2 text-13.5 font-extrabold text-body"
        >
          {current.lead}
          <span className="min-w-0 flex-1 truncate text-left">{current.label}</span>
          {current.trail}
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"
            className={`shrink-0 text-primary ${open ? "rotate-180" : ""}`}>
            <path d="M3 5.2 7 9.2l4-4" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && (
        // 컨트롤과 같은 폭·같은 모서리로 바로 아래에 띄운다 — 전폭 흰 판으로 깔면
        // 바와 경계가 사라져 「펼쳐진 목록」이 아니라 화면 일부처럼 보인다
        <div className="absolute inset-x-6 top-full z-50 -mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {items.map((item) => (
            <NavItemLink
              key={item.key} item={item} onDone={() => setOpen(false)}
              className={`flex w-full items-center gap-2 border-b border-gray-50 px-3 py-2.5 text-left text-13.5 last:border-0 ${
                item.active ? "bg-primary-bg font-extrabold text-primary-dark" : "font-semibold text-gray-600"
              }`}
            >
              {item.lead}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.trail}
            </NavItemLink>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 농장 선택 바 — 헤더 바로 아래 전폭 띠. 넓으면 알약 나열, 좁으면 드롭다운.
 * 스코프 스위처(이동)와 통계 농장 필터(선택)가 같은 위치·같은 모양을 쓰도록 공유한다.
 */
export function ScopeBar({
  items, ariaLabel,
}: {
  items: NavItemData[];
  ariaLabel: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="w-full border-b border-gray-100 bg-white">
      <NavDropdown items={items} ariaLabel={ariaLabel} className="mx-auto max-w-7xl sm:hidden" />

      <div className="mx-auto hidden max-w-7xl flex-wrap items-center gap-2 px-6 py-2.5 sm:flex">
        {items.map((item) => (
          <NavItemLink
            key={item.key} item={item}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 text-13 focus:outline-none ${
              item.active
                ? "border-primary bg-primary font-extrabold text-white"
                : "border-gray-200 bg-white font-bold text-gray-600 hover:border-primary hover:text-primary-dark"
            }`}
          >
            {item.lead}
            <span>{item.label}</span>
            {item.trail}
          </NavItemLink>
        ))}
      </div>
    </nav>
  );
}
