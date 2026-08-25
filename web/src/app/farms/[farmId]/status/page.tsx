"use client";

/**
 * 농장 상세 · 상태 (디자인 "농장 상세: 상태").
 * 상태 요약 · 지역 날씨 · 설비 현황 · 실시간 배치도 · 하드웨어 · 환경 상태 · 탱크
 *
 * 이 화면의 모든 카드는 **한 판정**을 나눠 본다 (lib/deviceStatus.deviceGroups).
 * 고리·배치도 표식·타일·요약 칩이 각자 색을 정하면 같은 장치가 카드마다 다른
 * 상태로 보인다 — 어느 쪽이 맞는지 사람이 대조해야 한다.
 *
 * 개수는 농장마다 다르다. 탱크 3기면 3기가 폭을 나눠 갖고, 없는 종류는 아예
 * 그리지 않는다 — 디자인의 「4기·19대」는 성주 농장의 한 순간일 뿐이다.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArcGauge, Card, GO_LINK, SectionTitle, StatusMark, StatusRing, TankColumn,
  trimNum, type RingSlice,
} from "@/components/ui";
import { SENSOR_META, SEV_STYLE, TANK_LABEL } from "@/lib/severity";
import { FarmMap } from "@/components/FarmMap";
import { useFarmData } from "@/lib/farmData";
import {
  deviceGroups, inputFromSnapshot, RING_ORDER,
  type DeviceStatus, type Ranges, type StatusInput,
} from "@/lib/deviceStatus";
import { fetchHistory, useFarmSnapshot } from "@/lib/farmDetail";
import { farmStatus } from "@/lib/fleet";
import {
  controlBlocked, sensorLiveness, timeAgo, type SensorValue, type StopState,
} from "@/lib/monitor";
import {
  isKoreaDaytime, isValidWeatherLocation, parseWeatherCondition, refreshWeather,
  uvIndexLabel, weatherConditionLabel, weatherIcon,
} from "@/lib/weather";

/**
 * 환경 상태에 고정으로 보여줄 항목 — 이 여섯이 화면의 뼈대다. 센서가 늘어도
 * 카드가 늘어나지 않게 목록을 못 박는다 (수위계는 탱크 카드가 따로 말한다).
 */
const ENV_TYPES = ["temperature", "humidity", "co2", "ec", "illuminance", "power"];
const ENV_SLOTS = ENV_TYPES.length;

/**
 * 규칙 기반 상태 요약 — LLM 미연동(FR-30)이므로 서술형 문구를 규칙으로 만든다.
 * "자동 생성" 라벨을 붙여 사람이 쓴 문장과 구분한다 (FR-30 비고).
 *
 * 화면이 이미 고른 값(input)으로 문장을 만든다. 예전에는 이 함수가 컨텍스트에서
 * 직접 실시간 값을 읽어, 농장을 옮긴 직후 **이전 농장 수치**로 문장을 만들었다.
 */
function summaryLine(farmId: string, input: StatusInput, stops: StopState): string {
  // 값과 상태는 살아 있는 장치의 것만 말한다. 마지막으로 받은 값을 그대로 읽으면
  // 통신이 끊긴 뒤에도 「25.0℃ · 로봇 1대 작업 중」이 현재형으로 남는다 —
  // 하드웨어 목록은 전부 오프라인인데 요약만 정상인 것처럼 보인다.
  const fresh = (v: SensorValue | undefined) =>
    v && v.value != null && sensorLiveness(v.ts) === "online" ? v : undefined;
  const temp = fresh(input.sensors.find((v) => v.sensor_type === "temperature"));
  const hum = fresh(input.sensors.find((v) => v.sensor_type === "humidity"));
  const envPart =
    temp?.value != null && hum?.value != null
      ? `내부 ${temp.value.toFixed(1)}℃ · 습도 ${hum.value.toFixed(0)}%`
      : "환경 데이터 수신 중단";

  // 등록 여부는 대장으로, 살아 있는지는 값으로 본다 — 등록만 되고 한 번도 발행하지
  // 않은 로봇을 「없는 로봇」으로 말하면 안 된다
  const registered = input.robotIds?.length ? input.robotIds : input.robots.map((r) => r.device_id);
  const live = input.robots.filter((r) => input.conns[r.device_id]?.state === "online");
  const working = live.filter((r) => r.phase === "working").length;
  const robotPart = controlBlocked(stops, farmId)
    ? "로봇 정지 중"
    : registered.length === 0 ? "등록된 로봇 없음"
    : live.length === 0 ? "로봇 상태 확인 불가"
    : working ? `로봇 ${working}대 작업 중` : "로봇 대기 중";

  return `${envPart} · ${robotPart}`;
}

/**
 * 적정 범위가 없는 항목의 비교 기준 — 24시간 평균. 상·하한이 설정되지 않은 센서는
 * 게이지에 띠를 못 그려 「지금 값이 평소와 다른가」를 말할 수 없다.
 *
 * 표시 중인 항목만, 많아도 둘까지 받는다 — 게이지마다 이력을 받으면 화면 진입이
 * 그만큼 느려지고, 이건 어디까지나 기준이 없을 때의 대타다.
 */
function useDailyAvg(farmId: string, types: string[], ready: boolean) {
  // 범위가 도착하기 전에는 부르지 않는다. 스냅샷이 오기 전엔 모든 항목이 「범위 없음」
  // 으로 보여, 그 상태로 부르면 범위가 온 뒤 대상이 바뀌어 같은 화면에서 두 번 받는다.
  const key = ready ? types.slice(0, 2).join(",") : "";
  const [avg, setAvg] = useState<Record<string, number>>({});
  useEffect(() => {
    setAvg({});
    if (!key) return;
    let alive = true;
    void (async () => {
      const out: Record<string, number> = {};
      try {
        for (const t of key.split(",")) {
          const pts = await fetchHistory(farmId, t, 24, 60);
          if (pts.length) out[t] = pts.reduce((a, p) => a + p.avg, 0) / pts.length;
        }
      } catch {
        // 비교 기준이 없는 것뿐이다 — 게이지는 「적정 범위 미설정」으로 그려진다
      }
      if (alive) setAvg(out);
    })();
    return () => { alive = false; };
  }, [farmId, key]);
  return avg;
}

/**
 * 게이지 축 끝값 — 적정 범위를 양쪽으로 절반씩 넓힌다. 축을 적정 범위에 딱 맞추면
 * 상한을 넘은 값이 전부 「꽉 찬 게이지」로 같아 보여, 살짝 넘었는지 두 배로 넘었는지
 * 구분되지 않는다.
 */
function axisRange(
  type: string, lo: number | null, hi: number | null, value: number | null,
): { min: number; max: number } {
  if (lo == null && hi == null) {
    // 기준이 없으면 현재값에서 축을 만드는데, 그 축이 값에 딱 붙으면 값이 조금 흔들릴
    // 때마다 끝값이 7↔8 로 오가며 게이지가 다시 그려진다 — 값은 그대로인데 눈금이
    // 움직여 늘었는지 줄었는지 못 읽는다. 1·2·5 단위로 올려 붙잡아 둔다.
    return { min: 0, max: niceCeil(Math.abs(value ?? 1) * 1.6) };
  }
  const l = lo ?? (hi as number) * 0.5;
  const h = hi ?? (lo as number) * 1.5;
  const pad = Math.abs(h - l) * 0.5 || Math.abs(h) * 0.2 || 1;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  // 음수가 없는 양(습도·조도·ppm·전력)은 0에서 시작한다. 온도만 영하가 있다.
  const min = l - pad < 0 && type !== "temperature" ? 0 : round1(l - pad);
  return { min, max: round1(h + pad) };
}

/** 1 · 2 · 5 × 10ⁿ 중 가장 가까운 위쪽 값 — 눈금이 값에 따라 흔들리지 않게 */
function niceCeil(n: number): number {
  if (!(n > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(n));
  for (const step of [1, 2, 5, 10]) {
    if (n <= step * pow) return step * pow;
  }
  return 10 * pow;
}

function FarmWeather({ farmId }: { farmId: string }) {
  // 컨텍스트에서 받는다 — 화면마다 훅을 부르면 이동할 때마다 「로딩중」이 되살아난다.
  // 수동 새로고침은 같은 소유자의 reload 를 쓴다 (따로 부르면 폴링이 이중이 된다)
  const { weather: rows, weatherLoading: loading, reloadWeather: reload } = useFarmData();
  const [refreshing, setRefreshing] = useState(false);
  const weather = rows.find((row) => row.farm_id === farmId);
  const hasValidLocation = isValidWeatherLocation(
    weather?.latitude ?? null, weather?.longitude ?? null,
  );
  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshWeather(farmId);
    await reload();
    setRefreshing(false);
  };
  const regionLabel = weather?.name.split(/\s+/)[0] ?? "";
  const conditionLabel = weatherConditionLabel(weather?.condition ?? null);
  const conditionCodes = parseWeatherCondition(weather?.condition ?? null);
  const isNight = !isKoreaDaytime();
  const weatherTheme = !weather?.ts
    ? {
        panel: "border-[#E5E8EB] bg-white",
        heading: "text-[#191F28]", badge: "bg-[#F2F4F6] text-[#6B7684]",
        primary: "text-[#191F28]", secondary: "text-[#6B7684]",
        metric: "bg-[#F7F8FA]",
      }
    : conditionCodes?.sky === 4
      ? {
          panel: "border-[#C7CDD4] bg-gradient-to-br from-[#D9DDE2] to-[#EEF0F2]",
          heading: "text-[#303841]", badge: "bg-white/80 text-[#56616D]",
          primary: "text-[#252B31]", secondary: "text-[#5D6873]",
          metric: "bg-white/90",
        }
      : isNight
        ? {
            panel: "border-black bg-gradient-to-br from-[#090D16] to-[#182235]",
            heading: "text-white", badge: "bg-white/15 text-[#E7F0FF]",
            primary: "text-white", secondary: "text-[#D8E5F7]",
            metric: "bg-white/95",
          }
        : {
            panel: "border-[#B9D5F8] bg-gradient-to-br from-[#D2E6FF] to-[#EAF4FF]",
            heading: "text-[#0B3D91]", badge: "bg-white text-[#1B64DA]",
            primary: "text-[#0B3D91]", secondary: "text-[#3A5A86]",
            metric: "bg-white",
          };

  return (
    <Card className={`border shadow-none transition-colors duration-500 ${weatherTheme.panel}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={`truncate text-16 font-extrabold ${weatherTheme.heading}`}>
          {regionLabel ? `${regionLabel} 지역 날씨` : "지역 날씨"}
        </h2>
        <span
          title={weather?.received_at ? `${timeAgo(weather.received_at)} 갱신` : undefined}
          className={`flex-none rounded-lg px-2.5 py-1 text-11.5 font-extrabold ${weatherTheme.badge}`}
        >
          외부 기상 연동
        </span>
      </div>

      {loading ? (
        <div className="py-10 text-center text-17 font-extrabold text-[#3A5A86]">로딩중</div>
      ) : weather?.ts ? (
        <>
          <div className="mt-4 flex items-center gap-4">
            <span className="text-56 leading-none drop-shadow-sm" aria-hidden="true">
              {weatherIcon(weather.condition)}
            </span>
            <div className="min-w-0">
              <div className={`text-34 font-extrabold leading-none ${weatherTheme.primary}`}>
                {weather.temperature_c != null ? weather.temperature_c.toFixed(1) : "—"}℃
              </div>
              <div className={`mt-1.5 truncate text-13.5 font-bold ${weatherTheme.secondary}`}>
                {conditionLabel} · 습도 {weather.humidity_pct != null ? `${Math.round(weather.humidity_pct)}%` : "—"} · 강수 {weather.precipitation_mm != null ? `${weather.precipitation_mm}mm` : "—"}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className={`rounded-xl px-3 py-2.5 ${weatherTheme.metric}`}>
              <div className="text-11.5 font-bold text-[#8B95A1]">바람</div>
              <div className="mt-0.5 text-16 font-extrabold text-[#191F28]">
                {weather.wind_ms != null ? `${weather.wind_ms}m/s` : "—"}
              </div>
            </div>
            <div className={`rounded-xl px-3 py-2.5 ${weatherTheme.metric}`}>
              <div className="text-11 font-bold text-[#8B95A1]">자외선 지수</div>
              <div className="mt-0.5 text-16 font-extrabold text-[#F27A00]">
                {uvIndexLabel(weather.solar_level)}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="text-15 font-extrabold text-[#3A5A86]">
            {weather?.latitude != null || weather?.longitude != null
              ? "정보 없음"
              : "날씨 조회 위치가 설정되지 않았습니다."}
          </span>
          {hasValidLocation && (
            <button
              type="button" onClick={() => void handleRefresh()} disabled={refreshing}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-12.5 font-extrabold text-[#4E5968] hover:bg-gray-50 disabled:opacity-50"
            >
              {refreshing ? "새로고침 중…" : "새로고침"}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

/** 등급 개수 배지 — 「경고 2」. 0 이면 아예 그리지 않는다 (0 을 적으면 눈이 먼저 간다) */
function SevCount({ sev, n }: { sev: string; n: number }) {
  if (!n) return null;
  const s = SEV_STYLE[sev];
  return (
    <span className={`inline-flex items-center gap-1 text-12 font-extrabold ${s.text}`}>
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      {s.label} {n}
    </span>
  );
}

export default function StatusTab() {
  const { farmId } = useParams<{ farmId: string }>();
  const { sensors, conns, robots, stops, liveFarm } = useFarmData();
  const snap = useFarmSnapshot(farmId);
  const status = snap ? farmStatus(snap, stops) : null;
  // 적정 범위는 **스냅샷에서** 받는다. 따로 알림 규칙을 부르면 요청이 하나 늘고,
  // 무엇보다 근거가 둘이 된다 — farmStatus 는 스냅샷의 범위로 「경고」를 세는데
  // 게이지는 다른 응답의 범위로 색을 칠하면 같은 센서가 카드마다 다르게 보인다.
  // (스냅샷은 enabled 인 규칙만 싣는다 — 꺼 둔 규칙으로 경고를 내지 않으려고)
  const ranges: Ranges = snap?.ranges ?? {};

  // 배치도·하드웨어가 함께 쓰는 지목 상태. hover 는 스쳐 지나가는 것, pin 은 눌러
  // 고정한 것 — 손을 떼도 남아야 다른 카드에서 대조할 수 있다.
  //
  // hover 가 pin 보다 앞선다. 고정해 둔 채로도 다른 장치를 훑어볼 수 있어야 하고,
  // 손을 떼면 고정한 것으로 돌아온다 (pin 을 앞세우면 고정한 순간 hover 가 죽는다).
  const [hover, setHover] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const active = hover ?? pin;
  const select = (id: string) => setPin((p) => (p === id ? null : id));

  // 아무 곳이나 다시 누르면 지목이 풀린다 — 지목은 「지금 보고 있는 것」이지 화면의
  // 설정이 아니다. 고를 수 있는 것(표식·타일)은 여러 카드에 흩어져 있어 한 컨테이너로
  // 묶을 수 없으므로, 그쪽에 표를 달아 두고 그 밖을 눌렀는지로 판정한다.
  useEffect(() => {
    if (!pin) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.("[data-device-pick]")) setPin(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPin(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pin]);

  /**
   * 이 화면이 보는 값은 **모두 지금 보고 있는 농장 것**이어야 한다.
   *
   * 값이 두 통로로 들어온다. 실시간 통로(WS)는 한 농장만 구독하고, 스냅샷 통로는
   * 모든 농장을 15초마다 한 벌씩 받아 둔다. 농장을 옮기면 실시간 통로는 구독을
   * 갈아타야 해서 한 왕복 동안 **이전 농장 값을 그대로 들고 있다**. 그 값으로 세면
   * 이전 농장 센서와 새 농장 탱크가 섞여 개수와 고리 색이 요동친다.
   *
   * 스냅샷은 농장별로 담겨 있어 옮긴 즉시 새 농장 것이 있다. 그래서 스냅샷으로
   * 먼저 그리고, 실시간 값이 **같은 농장 것임이 확인되면** 그때 갈아탄다. 기다릴
   * 것이 없으니 회색 자리표시도 필요 없다.
   *
   * 판단은 실시간 값에 붙어 오는 출처(liveFarm)로 한다. 「받았음」 불리언과 지금
   * 스코프를 견주는 방식은 한 프레임 새는 구멍이 있었다 — 구독 교체가 렌더 뒤에
   * 돌아서, 스코프는 이미 새 농장인데 값은 아직 이전 농장인 순간이 그려진다.
   */
  const liveIsThisFarm = liveFarm === farmId;
  const base = snap ? inputFromSnapshot(snap) : null;
  const input: StatusInput | null = liveIsThisFarm
    ? {
        ...base,
        sensors: Object.values(sensors),
        conns,
        robots: Object.values(robots),
        tanks: base?.tanks ?? [],
        stations: base?.stations ?? [],
        ranges,
      }
    : base;

  const groups = input ? deviceGroups(input) : [];
  const all = groups.flatMap((g) => g.items);
  const summary = input ? summaryLine(farmId, input, stops) : null;
  const byId: Record<string, DeviceStatus> = Object.fromEntries(all.map((d) => [d.id, d]));
  const warnCount = all.filter((d) => d.sev === "warning").length;
  const cautionCount = all.filter((d) => d.sev === "caution").length;

  const slices: RingSlice[] = RING_ORDER.map((sev) => ({
    key: sev,
    label: SEV_STYLE[sev].label,
    names: all.filter((d) => d.sev === sev).map((d) => `${d.name} · ${d.label}`),
  }));

  const deviceLink = `/settings?farm=${farmId}&section=devices`;

  // ── 환경 상태에 세울 여섯 칸 ──
  // 주요 항목을 순서대로 채우고, 없는 항목이 있으면 남은 센서로 메운다. 빈 칸을
  // 두면 「센서가 없다」와 「자리가 비었다」가 구분되지 않는다.
  const pool = (input?.sensors ?? []).filter((s) => s.sensor_type !== "water_level");
  const envSensors: SensorValue[] = [];
  for (const t of ENV_TYPES) {
    const found = pool.find((s) => s.sensor_type === t);
    if (found) envSensors.push(found);
  }
  for (const s of pool) {
    if (envSensors.length >= ENV_SLOTS) break;
    if (!envSensors.includes(s)) envSensors.push(s);
  }
  const noRange = envSensors
    .filter((s) => ranges[s.sensor_type]?.min == null && ranges[s.sensor_type]?.max == null)
    .map((s) => s.sensor_type);
  const dailyAvg = useDailyAvg(farmId, noRange, snap != null);

  const tanks = groups.find((g) => g.kind === "tank")?.items ?? [];

  return (
    <>
      {/* 상태 요약 + 날씨 */}
      <section className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle
            title="상태 요약"
            right={
              <span className="rounded-lg bg-status-info/10 px-2 py-0.5 text-11 font-extrabold text-status-infoDark">
                자동 생성
              </span>
            }
          />
          {/* 농장을 옮겨도 스냅샷에 새 농장 값이 이미 있으므로 곧바로 적는다.
              자리표시로 바꿨다 되돌리면 카드 높이가 오가며 아래 카드까지 밀린다 */}
          {summary ? (
            <p className="text-14 font-semibold leading-relaxed text-gray-700">{summary}</p>
          ) : (
            <p aria-hidden="true" className="h-6 w-3/4 animate-pulse rounded bg-gray-100" />
          )}
          {/* 심각도별로 한 줄씩 — 지금 걸린 이슈를 등급별로 모아 보여준다.
              정지·엣지 문제가 센서 문제를 가리면 안 된다 (고치는 사람도 시점도 다르다) */}
          {input && (
            <div className="mt-3 space-y-1.5">
              {(["warning", "caution"] as const).map((sev) => {
                const hit = status?.reasons.filter((r) => r.sev === sev) ?? [];
                if (!hit.length) return null;
                return (
                  // 등급은 고정폭 칸, 이슈는 그 오른쪽에서만 줄바꿈한다 — 한 컨테이너에
                  // 나란히 두면 넘칠 때 둘째 줄이 등급 아래(맨 왼쪽)부터 시작한다
                  <div key={sev} className="flex items-start gap-1.5">
                    <span className={`inline-flex w-14 flex-none items-center gap-1.5 py-1 text-12 font-extrabold ${SEV_STYLE[sev].text}`}>
                      <StatusMark sev={sev} />
                      {SEV_STYLE[sev].label}
                    </span>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {hit.map((reason, i) => (
                        <span
                          key={`${reason.text}-${i}`}
                          className={`rounded-lg px-2.5 py-1 text-12 font-bold ${SEV_STYLE[sev].bg} ${SEV_STYLE[sev].text}`}
                        >
                          {reason.text}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
              {status && status.reasons.length === 0 && (
                <div className="flex items-center gap-1.5 text-12 font-bold text-primary-dark">
                  <StatusMark sev="ok" />
                  정상 · 정지·통신·값·잔량 모두 이상 없음
                </div>
              )}
              {!status && (
                <div className="flex items-center gap-1.5 text-12 font-bold text-muted">
                  <StatusMark sev="idle" label="확인 중" />
                  확인 중 · 농장 상태를 아직 받지 못했습니다
                </div>
              )}
            </div>
          )}
          <p className="mt-3 text-11.5 font-semibold text-muted">
            규칙 기반 요약입니다. LLM 연동 후 서술형 분석·조치 권고로 확장됩니다 (FR-30).
          </p>
        </Card>
        <FarmWeather farmId={farmId} />
      </section>

      {/* 설비 현황 + 배치도 | 하드웨어 */}
      <section className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-15 font-extrabold">설비 현황</h3>
              <SevCount sev="warning" n={warnCount} />
              <SevCount sev="caution" n={cautionCount} />
              <Link href={deviceLink} scroll={false} className={`${GO_LINK} ml-auto`}>
                장치 관리
              </Link>
            </div>
            {all.length === 0 ? (
              <p className="py-8 text-center text-13 text-muted">
                등록된 장비가 없어요. 설정에서 추가하세요.
              </p>
            ) : (
              <div className="flex items-center gap-5">
                <StatusRing slices={slices} total={all.length} caption="대 등록" />
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                  {groups.map((g) => (
                    <div key={g.kind}>
                      <div className="mb-1 flex items-baseline gap-1.5">
                        <span className="text-12 font-extrabold">{g.label}</span>
                        <span className={`ml-auto text-11.5 font-bold ${SEV_STYLE[g.tone].text}`}>
                          {g.ratio}
                        </span>
                      </div>
                      {/* 대수만큼 칸을 나눈다 — 어느 한 대가 나쁜지 위치로 짚을 수 있다 */}
                      <div className="flex h-2 gap-[3px]">
                        {g.items.map((d) => (
                          <span
                            key={d.id}
                            title={`${d.name} · ${d.label}`}
                            className={`flex-1 rounded-sm ${SEV_STYLE[d.sev].dot}`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <FarmMap
            farmId={farmId}
            robots={Object.values(robots)}
            statuses={byId}
            active={active}
            onHover={setHover}
            onSelect={select}
          />
        </div>

        <Card className="flex flex-col">
          <SectionTitle
            title="하드웨어" sub={`${all.length}대`}
            right={
              // 이 농장의 장치 관리로 바로 — 설정 화면은 농장이 여럿이면 접혀 있다.
              // scroll={false} — Next 가 맨 위로 올리면 설정 화면의 정렬을 덮어쓴다
              <Link href={deviceLink} scroll={false} className={GO_LINK}>
                장치 관리
              </Link>
            }
          />
          <div className="flex flex-1 flex-col justify-between gap-4">
            {groups.map((g) => (
              <div key={g.kind}>
                {/* 대수 바로 옆에 등급 요약을 붙인다 — 「센서 9」와 「경고 1」이 한 문장으로
                    읽혀야 한다. 오른쪽 끝으로 밀면 눈이 줄을 한 번 더 건너야 한다.
                    누를 것이 아니므로 링크로 감싸지 않는다 (탭으로 가는 길은 카드 머리) */}
                <div className="mb-2 flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-12 font-extrabold text-gray-600">{g.label}</span>
                  <span className="text-12 font-bold text-muted">{g.count}</span>
                  <span className={`text-11.5 font-extrabold ${SEV_STYLE[g.tone].text}`}>
                    {g.summary}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {g.items.map((d) => {
                    const on = active === d.id;
                    const s = SEV_STYLE[d.sev];
                    return (
                      // 눌러 고정하면 배치도의 같은 장치가 함께 강조된다 — 목록에서 고른
                      // 장치가 농장 어디에 있는지 눈으로 잇는 것이 이 카드의 일이다.
                      // 탭으로 넘어가는 길은 그룹 제목 옆 요약과 카드 머리의 링크가 맡는다.
                      <button
                        key={d.id}
                        type="button"
                        title={`${d.name} · ${d.label}`}
                        aria-pressed={on}
                        onMouseEnter={() => setHover(d.id)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(d.id)}
                        onBlur={() => setHover(null)}
                        onClick={() => select(d.id)}
                        data-device-pick=""
                        className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1.5 text-left transition-colors ${
                          on ? "border-body bg-[#EDEFF2]" : `${s.border} ${s.bg}`
                        }`}
                      >
                        <StatusMark sev={d.sev} label={d.label} />
                        <span className={`min-w-0 flex-1 truncate text-11.5 ${on ? "font-extrabold" : "font-bold"}`}>
                          {d.short}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {all.length === 0 && (
              <div className="text-12.5 font-semibold text-muted">
                등록된 장비가 없어요. 설정에서 추가하세요.
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* 환경 상태 + 탱크 */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <h3 className="text-15 font-extrabold">환경 상태</h3>
            {/* 게이지 색이 무슨 뜻인지 — 값이 나쁜 것과 값이 낡은 것은 다른 문제다 */}
            {[["ok", "정상"], ["caution", "갱신 지연"], ["warning", "적정 범위 밖"]].map(
              ([sev, label]) => (
                <span key={sev} className="inline-flex items-center gap-1.5 text-11.5 font-bold text-gray-500">
                  <span className={`h-2 w-2 rounded-full ${SEV_STYLE[sev].dot}`} />
                  {label}
                </span>
              ),
            )}
            <Link href={`/farms/${farmId}/env`} className={`${GO_LINK} ml-auto`}>
              생육기·센서
            </Link>
          </div>
          {envSensors.length === 0 ? (
            <p className="py-8 text-center text-13 text-muted">등록된 환경 센서가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-1 sm:grid-cols-3">
              {envSensors.map((s) => {
                const meta = SENSOR_META[s.sensor_type] ?? { name: s.sensor_type, unit: s.unit };
                const r = ranges[s.sensor_type];
                const lo = r?.min ?? null;
                const hi = r?.max ?? null;
                const axis = axisRange(s.sensor_type, lo, hi, s.value);
                const st = byId[s.sensor_id];
                // 값 축과 수신 축 중 나쁜 쪽이 게이지 색이다 — 적정 범위 안이라도
                // 4분 전 값이면 지금 적정이라고 말할 수 없다.
                const sev = st?.sev ?? "idle";
                // 배지도 **같은 수신 축**을 본다. 여기서 sensorLiveness 로 다시 재면
                // 생육기가 끊긴 경우가 빠진다 (그때는 센서 자기 시각은 멀쩡하다) —
                // 게이지는 주황인데 배지는 없는 상태가 된다.
                const stale = st?.axes.some((a) => a.axis === "수신" && a.sev !== "ok") ?? false;
                const over = s.value != null && hi != null && s.value > hi;
                const under = s.value != null && lo != null && s.value < lo;
                const avg = dailyAvg[s.sensor_type];
                return (
                  <ArcGauge
                    key={s.sensor_id}
                    label={meta.name} unit={meta.unit}
                    value={s.value} min={axis.min} max={axis.max}
                    okMin={lo} okMax={hi}
                    sev={sev === "busy" ? "ok" : sev}
                    digits={meta.unit === "ppm" ? 0 : 1}
                    sub={
                      over ? <span className="font-bold text-status-warningDark">적정 초과 · 상한 {trimNum(hi as number)}</span>
                      : under ? <span className="font-bold text-status-warningDark">적정 미달 · 하한 {trimNum(lo as number)}</span>
                      : lo != null && hi != null ? `적정 ${trimNum(lo)}~${trimNum(hi)}`
                      : avg != null ? `24시간 평균 ${avg.toFixed(1)}`
                      : "적정 범위 미설정"
                    }
                    badge={
                      stale ? (
                        <span className="absolute right-1 top-0.5 inline-flex items-center gap-1 rounded-full border border-[#F7DFB0] bg-status-caution/10 px-1.5 py-0.5">
                          <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" aria-hidden="true">
                            <path
                              d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z M12 7.5V12l3 2"
                              fill="none" stroke="#E07800" strokeWidth={2.2}
                              strokeLinecap="round" strokeLinejoin="round"
                            />
                          </svg>
                          <span className="text-10.5 font-extrabold text-status-cautionDark">
                            {timeAgo(s.ts)}
                          </span>
                        </span>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </Card>

        <Card className="flex flex-col">
          <SectionTitle
            title="탱크"
            right={
              <Link href={`/farms/${farmId}/supply`} className={GO_LINK}>
                작업·공급
              </Link>
            }
          />
          {tanks.length === 0 ? (
            <p className="py-8 text-center text-13 text-muted">등록된 탱크가 없습니다.</p>
          ) : (
            // 기수만큼 폭을 나눠 갖는다 — 3기면 3기 폭으로 넓어진다
            <div className="flex flex-1 items-stretch gap-2.5">
              {tanks.map((d) => {
                const t = snap?.tanks.find((x) => x.device_id === d.id);
                const bad = d.sev === "caution" || d.sev === "warning";
                const amount = t?.remain_l != null ? `약 ${t.remain_l}L` : "—";
                const left = t?.days_left != null ? `${t.days_left}일분`
                  : t?.uses_left != null ? `${t.uses_left}회분` : "";
                return (
                  <TankColumn
                    key={d.id}
                    label={t ? TANK_LABEL[t.tank_type] ?? d.short : d.short}
                    pct={d.levelPct ?? null}
                    sev={d.sev}
                    amount={amount}
                    // 나쁠 때는 남은 기간 대신 이유를 적는다 — 「3회분」과 「잔량 부족」
                    // 중 사람이 움직여야 하는 쪽이 눈에 걸려야 한다
                    note={bad ? d.label.replace(/^\d+%\s*/, "") : left}
                  />
                );
              })}
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
