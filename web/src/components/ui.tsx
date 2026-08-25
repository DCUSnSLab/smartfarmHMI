"use client";

/**
 * 공용 UI 프리미티브 — 디자인 전달본 토큰 기반 (docs/design/README.md 디자인 토큰).
 * 상태는 색 + 도형·문자 병기 (비기능 §5 접근성: 색 단독 구분 금지).
 *
 * **그리는 것만** 여기 둔다. 등급·문구·색과 등급을 정하는 규칙은 lib/severity 에 있다 —
 * 판정 로직(lib/deviceStatus·lib/fleet)이 그 어휘를 쓰는데, 어휘가 이 파일에 있으면
 * 순수 로직이 React·next/link 까지 끌고 들어와 단독으로 시험할 수 없다.
 */

import { CSSProperties, RefObject, useCallback, useEffect, useRef, useState } from "react";
// 등급·문구·색은 lib/severity 가 갖는다 — 여기는 그리는 쪽이다.
import { SEV_STYLE, sevHex, TANK_LOW_PCT } from "@/lib/severity";
import Link from "next/link";
import { usePathname } from "next/navigation";

// 헤더 컨트롤 공통 — 높이·글자·정렬 통일. 터치 기기에서만 40px 로 키운다 (비기능 §5)
export const CONTROL =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl text-13.5 [@media(pointer:coarse)]:h-10";

/** 아이콘 전용 정사각 컨트롤 */
export const CONTROL_ICON = `${CONTROL} w-9 justify-center [@media(pointer:coarse)]:w-10`;

/**
 * 다른 화면으로 가는 링크 — 섹션 제목 오른쪽 (「장치 관리」·「모두 보기」 등).
 * 색만으로는 누를 수 있다는 게 약해 커서와 hover 배경으로 클릭 영역을 드러낸다.
 */
export const GO_LINK =
  "cursor-pointer whitespace-nowrap rounded-lg px-2 py-1 text-12.5 font-bold " +
  "text-primary-dark transition-colors hover:bg-primary-bg";

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

/**
 * 상태 표식 — 색과 **도형**을 함께 쓴다 (비기능 §5: 색으로만 구분하지 않는다).
 *
 *   원 초록 = 정상 · 사각형 파랑 = 정보·대기 · 마름모 주황 = 주의 · 삼각형 빨강 = 경고
 *
 * 화면 전체가 같은 도형 규칙을 쓴다 — 농장 점, 하드웨어 목록, 각 탭의 배지가
 * 서로 다른 표식을 쓰면 같은 뜻인지 매번 다시 읽어야 한다.
 */
export function StatusMark({ sev, label }: { sev: string; label?: string }) {
  const s = SEV_STYLE[sev] ?? SEV_STYLE.info;
  const shape =
    sev === "warning" ? "h-2.5 w-2.5 [clip-path:polygon(50%_0%,100%_100%,0%_100%)]"
    : sev === "caution" ? "h-2 w-2 rotate-45"
    : sev === "info" ? "h-2 w-2 rounded-[2px]"
    : "h-2 w-2 rounded-full";
  // 도형마다 크기가 다르므로 같은 크기의 상자 안에 넣어 가운데에 둔다.
  // 상자가 없으면 상태가 바뀔 때 옆 글자가 밀리고, 줄 높이에 따라 위아래로 어긋난다.
  return (
    <span
      role="img"
      aria-label={label ?? s.label}
      title={label ?? s.label}
      className="inline-flex h-3 w-3 flex-none items-center justify-center align-middle"
    >
      <span className={`${shape} ${s.dot}`} />
    </span>
  );
}

/** 표식 + 문구 한 쌍. 표식은 StatusMark 를 그대로 쓴다 (도형 규칙이 갈리지 않게) */
export function StatusDot({ sev, label }: { sev: string; label?: string }) {
  const s = SEV_STYLE[sev] ?? SEV_STYLE.info;
  return (
    <span className={`inline-flex items-center gap-1.5 text-12.5 font-bold ${s.text}`}>
      <StatusMark sev={sev} label={label} />
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

/**
 * 반원 아크 게이지 — 환경 상태 카드 (디자인 "농장 상세: 상태").
 *
 * 적정 범위(알림 규칙의 상·하한)를 연한 띠로 깔고 그 위에 현재값을 그린다.
 * 축 끝값은 적정 범위를 기준으로 넓혀 잡는다 — 상한에 딱 붙은 값도 눈에 보이게.
 *
 * 가운데 숫자는 SVG `<text>` 가 아니라 HTML 로 얹는다. SVG 글자는 viewBox 배율을
 * 따라가므로 큰글씨 3단계(root font-size)에 반응하지 않는다 (비기능 §5).
 */
const ARC_D = "M17 58 A42 42 0 0 1 101 58";
const ARC_LEN = Math.PI * 42;  // 반원 길이 (반지름 42) ≈ 131.95

/** 축 끝값 표시 — 정수는 소수점을 붙이지 않는다 (「16」 vs 「16.0」) */
export function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function ArcGauge({
  label, unit, value, min, max, okMin, okMax, sev = "ok", sub, badge, digits = 1,
}: {
  label: string;
  unit?: string;
  value: number | null;
  min: number; max: number;
  okMin?: number | null; okMax?: number | null;
  /** 값 축과 수신 축 중 나쁜 쪽 — 호출부가 정한다 (지연이면 값이 적정이어도 주황) */
  sev?: string;
  sub?: React.ReactNode;
  /** 게이지 위에 얹는 칩 (예: 「4분 전」) */
  badge?: React.ReactNode;
  digits?: number;
}) {
  const span = max - min || 1;
  const at = (v: number) => Math.max(0, Math.min(1, (v - min) / span)) * ARC_LEN;
  const filled = value == null ? 0 : at(value);
  const hex = value == null ? SEV_STYLE.idle.hex : sevHex(sev);

  // 적정 범위 띠 — 상·하한이 다 있을 때만. 한쪽만 있으면 「어디까지가 적정」이
  // 그림에서 거짓이 된다 (열린 구간을 띠로 그리면 닫힌 것처럼 보인다).
  const band = okMin != null && okMax != null
    ? { start: at(okMin), len: Math.max(0, at(okMax) - at(okMin)) }
    : null;

  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5">
      <div className="relative w-full max-w-[196px]">
        <svg viewBox="0 0 118 62" className="block h-auto w-full" aria-hidden="true">
          <path d={ARC_D} fill="none" stroke="#F2F4F6" strokeWidth={11} strokeLinecap="round" />
          {band && (
            <path
              d={ARC_D} fill="none" stroke="#E7F7EF" strokeWidth={11}
              strokeDasharray={`${band.len.toFixed(1)} ${ARC_LEN.toFixed(1)}`}
              strokeDashoffset={-band.start}
            />
          )}
          {value != null && (
            <path
              d={ARC_D} fill="none" stroke={hex} strokeWidth={11} strokeLinecap="round"
              strokeDasharray={`${filled.toFixed(1)} ${ARC_LEN.toFixed(1)}`}
            />
          )}
          {/* 축을 넘어선 값 — 호를 꽉 채우고 끝에 점을 얹어 「여기서 멈춘 게 아니다」를 남긴다 */}
          {value != null && value >= max && (
            <circle cx={101} cy={58} r={4.4} fill="#fff" stroke={hex} strokeWidth={2.4} />
          )}
        </svg>
        <div className="pointer-events-none absolute inset-x-0 bottom-[4%] flex justify-center">
          <span
            className={`text-17 font-extrabold leading-none ${
              value == null ? "text-muted"
              : sev === "ok" || sev === "busy" ? ""
              : SEV_STYLE[sev]?.text ?? ""
            }`}
          >
            {value == null ? "—" : value.toFixed(digits)}
          </span>
        </div>
        {badge}
      </div>
      <div className="flex w-full max-w-[172px] justify-between text-11 font-bold text-status-idle">
        <span>{trimNum(min)}</span>
        <span>{trimNum(max)}</span>
      </div>
      <div className="text-13 font-extrabold">
        {label}
        {unit && <span className="ml-1 text-11 font-bold text-muted">{unit}</span>}
      </div>
      {sub && <div className="text-center text-11 font-semibold text-muted">{sub}</div>}
    </div>
  );
}

/**
 * 수직 탱크 — 탱크 카드 (디자인 "농장 상세: 상태").
 * 개수는 농장마다 다르므로 폭을 나눠 갖는다 (flex-1) — 3기면 3기 폭으로 넓어진다.
 */
export function TankColumn({
  label, pct, sev, amount, note,
}: {
  label: string;
  pct: number | null;
  sev: string;
  /** 첫 줄 — 잔량 (「약 409.6L」) */
  amount: string;
  /** 둘째 줄 — 남은 기간이나 이유 (「4.1일분」·「잔량 부족」). 없어도 줄은 남긴다 */
  note?: string;
}) {
  const s = SEV_STYLE[sev] ?? SEV_STYLE.idle;
  const bad = sev === "caution" || sev === "warning";
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <span className={`text-17 font-extrabold ${bad ? s.text : ""}`}>
        {pct == null ? "—" : Math.round(pct)}
        <span className="text-11 font-bold text-muted">%</span>
      </span>
      <div
        className={`relative min-h-[104px] w-full max-w-[74px] flex-1 overflow-hidden rounded-xl border-[1.5px] bg-[#F7F8FA] ${
          bad ? "border-status-caution/40" : "border-[#DDE2E7]"
        }`}
      >
        {pct != null && (
          <div
            className={`absolute inset-x-0 bottom-0 ${s.dot}`}
            style={{ height: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        )}
        {/* 잔량 부족 기준선 — 「얼마나 남았나」를 숫자 없이 읽게 한다 */}
        <div
          className="absolute inset-x-0 border-t-[1.5px] border-dashed border-status-idle"
          style={{ bottom: `${TANK_LOW_PCT}%` }}
        />
      </div>
      <div className="flex items-center gap-1.5 text-12 font-extrabold">
        {bad && <StatusMark sev={sev} />}
        <span className="truncate">{label}</span>
      </div>
      {/*
        잔량과 남은 기간을 **줄로 나눠** 적는다. 한 줄에 「약 409.6L · 4.1일분」으로
        붙여 놓으면 큰글씨에서 긴 탱크만 두 줄로 접히고, 그 한 줄 때문에 그 칸의
        수위 막대(flex-1)가 남은 높이를 잃어 옆 칸보다 짧아진다 — 잔량을 비교하는
        그림인데 막대 길이가 글자 길이에 좌우된다.
        줄 수를 모든 칸에 똑같이 두 줄로 박아 두면 접힘도 높이 차이도 생기지 않는다.
      */}
      <div className={`w-full text-center text-10.5 ${bad ? `font-bold ${s.text}` : "font-semibold text-muted"}`}>
        <div className="truncate" title={amount}>{amount}</div>
        <div className="truncate" title={note || undefined}>{note || "\u00A0"}</div>
      </div>
    </div>
  );
}

export interface RingSlice {
  key: string;
  label: string;
  /** 이 등급에 속한 항목 이름 — 겹쳐 띄우는 설명에 적는다 */
  names: string[];
}

/**
 * 상태 고리 — 설비 현황 카드 (디자인 "농장 상세: 상태").
 *
 * 등급별 구성비를 한 고리에 담는다. 조각에 손을 올리면 그 등급에 속한 장치 이름을
 * 띄운다 — 「주의 2」가 어느 2대인지 목록을 훑지 않고 알 수 있어야 한다.
 * 선택 상태는 이 카드 안에서만 쓴다 (배치도·하드웨어와 공유하지 않는다).
 */
export function StatusRing({ slices, total, caption }: {
  slices: RingSlice[]; total: number; caption: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  // hover 가 pin 보다 앞선다 — 고정해 둔 채로도 다른 등급을 훑어볼 수 있고, 손을
  // 떼면 고정한 것으로 돌아온다 (배치도·하드웨어 타일과 같은 규칙)
  const active = hover ?? pin;
  // 고리 밖 아무 곳이나 누르면 고정이 풀린다. Esc 도 같다. 지목은 「지금 보고 있는
  // 것」이지 화면의 설정이 아니다 — 배치도·하드웨어와 같은 규칙인데, 저쪽은 고를
  // 것이 여러 카드에 흩어져 있어 표를 달아 판정하고 여기는 상자 하나라 ref 로 된다.
  const box = useRef<HTMLDivElement>(null);
  const unpin = useCallback(() => setPin(null), []);
  useLightDismiss(pin != null, box, unpin);

  const shown = slices.filter((sl) => sl.names.length > 0);
  const hit = shown.find((sl) => sl.key === active);

  let acc = 0;
  const segs = shown.map((sl) => {
    const pct = total ? (sl.names.length / total) * 100 : 0;
    const seg = { ...sl, pct, offset: acc, on: active === sl.key };
    acc += pct;
    return seg;
  });

  return (
    <div ref={box} className="relative h-[168px] w-[168px] flex-none">
      <svg
        viewBox="0 0 42 42" className="h-full w-full -rotate-90" role="img"
        aria-label={`${caption} ${total} — ${shown.map((sl) => `${sl.label} ${sl.names.length}`).join(", ")}`}
      >
        <circle cx={21} cy={21} r={15.9155} fill="none" stroke="#F2F4F6" strokeWidth={8.4} />
        {segs.map((seg) => (
          <circle
            key={seg.key}
            cx={21} cy={21} r={15.9155} pathLength={100} fill="none"
            stroke={sevHex(seg.key)}
            strokeWidth={seg.on ? 10.2 : 8.4}
            strokeDasharray={`${seg.pct.toFixed(1)} ${(100 - seg.pct).toFixed(1)}`}
            strokeDashoffset={-seg.offset}
            opacity={active == null || seg.on ? 1 : 0.3}
            className="cursor-pointer transition-[opacity,stroke-width] duration-100"
            onMouseEnter={() => setHover(seg.key)}
            onMouseLeave={() => setHover(null)}
            onClick={() => setPin((p) => (p === seg.key ? null : seg.key))}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-34 font-extrabold leading-none">{total}</span>
        <span className="text-11.5 font-bold text-muted">{caption}</span>
      </div>
      {hit && (
        // 배치도의 설명과 같은 폭 규칙 — 검은 상자가 화면에서 두 종류로 보이면 안 된다.
        // 고리 오른쪽에 붙이되, 좁은 화면에서는 고리 아래로 내린다 (고리 폭이 168px
        // 이라 오른쪽에 남는 자리가 카드를 넘어간다).
        <div className="pointer-events-none absolute left-0 top-full z-10 mt-2 w-48 max-w-[calc(100vw-4rem)] rounded-xl bg-body px-3 py-2.5 shadow-lg md:left-[calc(100%-14px)] md:top-2 md:mt-0">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 flex-none rounded-full" style={{ background: sevHex(hit.key) }} />
            <span className="text-12.5 font-extrabold text-white">{hit.label}</span>
            <span className="ml-auto text-12 font-extrabold text-gray-300">{hit.names.length}대</span>
          </div>
          <div className="mt-1.5 flex flex-col gap-0.5 border-t border-gray-600 pt-1.5">
            {hit.names.slice(0, 6).map((n) => (
              <span key={n} className="break-words text-11.5 font-semibold text-gray-200">{n}</span>
            ))}
            {hit.names.length > 6 && (
              <span className="text-11.5 font-semibold text-gray-400">
                그 외 {hit.names.length - 6}대
              </span>
            )}
          </div>
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
