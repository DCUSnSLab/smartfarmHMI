"use client";

/**
 * 공용 UI 프리미티브 — 디자인 전달본 토큰 기반 (docs/design/README.md 디자인 토큰).
 * 상태는 색 + 도형·문자 병기 (비기능 §5 접근성: 색 단독 구분 금지).
 */

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
      <h3 className="text-[15px] font-extrabold">{title}</h3>
      {sub && <span className="text-[12.5px] font-semibold text-muted">· {sub}</span>}
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

export function StatusDot({ sev, label }: { sev: string; label?: string }) {
  const s = SEV_STYLE[sev] ?? SEV_STYLE.info;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12.5px] font-bold ${s.text}`}>
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
      <div className="text-[13px] font-bold text-gray-500">{label}</div>
      <div className={`mt-1 text-[26px] font-extrabold leading-tight ${valueColor}`}>
        {value}
        {unit && <span className="ml-0.5 text-[13px] font-bold text-muted">{unit}</span>}
      </div>
      {detail && <div className="mt-1 text-[12px] font-semibold text-muted">{detail}</div>}
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
        <div className="mt-1 flex justify-between text-[11px] font-semibold text-muted">
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

/** 라인 차트 — 의존성 없이 SVG (디자인의 단순 추이 그래프) */
export function LineChart({
  series, height = 180, unitLabels = [],
}: {
  series: { name: string; color: string; points: { ts: string; value: number }[] }[];
  height?: number;
  unitLabels?: string[];
}) {
  const all = series.flatMap((s) => s.points.map((p) => p.value));
  if (all.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-[13px] font-semibold text-muted">
        데이터가 없어요
      </div>
    );
  }
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.15 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const W = 100;
  const H = 100;

  const path = (pts: { ts: string; value: number }[]) => {
    if (pts.length === 0) return "";
    const n = pts.length;
    return pts
      .map((p, i) => {
        const x = n === 1 ? 0 : (i / (n - 1)) * W;
        const y = H - ((p.value - lo) / (hi - lo)) * H;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  };

  const first = series[0]?.points ?? [];
  const timeLabel = (iso: string) =>
    new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3">
        {series.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1.5 text-[12px] font-bold text-gray-600">
            <span className="h-2 w-3 rounded-sm" style={{ background: s.color }} />
            {s.name}
            {unitLabels[i] && <span className="font-semibold text-muted">({unitLabels[i]})</span>}
          </span>
        ))}
        <span className="ml-auto text-[11.5px] font-semibold text-muted">
          {lo.toFixed(0)} ~ {hi.toFixed(0)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        style={{ height, width: "100%" }} role="img" aria-label="추이 그래프"
      >
        {[0, 25, 50, 75, 100].map((y) => (
          <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="#F2F4F6" strokeWidth="0.4" />
        ))}
        {series.map((s) => (
          <path
            key={s.name} d={path(s.points)} fill="none" stroke={s.color}
            strokeWidth="0.9" vectorEffect="non-scaling-stroke" strokeLinejoin="round"
          />
        ))}
      </svg>
      {first.length > 1 && (
        <div className="mt-1 flex justify-between text-[11px] font-semibold text-muted">
          <span>{timeLabel(first[0].ts)}</span>
          <span>{timeLabel(first[Math.floor(first.length / 2)].ts)}</span>
          <span>{timeLabel(first[first.length - 1].ts)}</span>
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
          <h3 className="text-[18px] font-extrabold">{title}</h3>
          {sub && <span className="text-[12.5px] font-semibold text-muted">{sub}</span>}
          <button
            onClick={onClose} aria-label="닫기"
            className="ml-auto text-[20px] leading-none text-gray-400"
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

export const MISSION_LABEL: Record<string, string> = {
  idle: "대기", moving: "이동 중", working: "작업 중", charging: "충전 중", error: "이상",
};
