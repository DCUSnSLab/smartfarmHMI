"use client";

/**
 * 농장 상세 · 상태 (디자인 "농장 상세: 상태").
 * 상태 요약 · 지역 날씨 · 실시간 배치도 · 하드웨어 리스트 · 환경 상태 게이지
 */

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Card, CONN_STYLE, Gauge, GO_LINK, SectionTitle, StatusDot, StatusMark,
  SENSOR_META, SEV_STYLE, STATION_STATE, TANK_LABEL, TANK_LOW_PCT, tankBadge,
} from "@/components/ui";
import { FarmMap } from "@/components/FarmMap";
import { useFarmData } from "@/lib/farmData";
import { useDevices, useFarmSnapshot, useRanges } from "@/lib/farmDetail";
import { farmStatus } from "@/lib/fleet";
import { controlBlocked, deviceLiveness, sensorLiveness, timeAgo, type SensorValue } from "@/lib/monitor";
import {
  isKoreaDaytime, isValidWeatherLocation, parseWeatherCondition, refreshWeather,
  uvIndexLabel, weatherConditionLabel, weatherIcon,
} from "@/lib/weather";

/**
 * 규칙 기반 상태 요약 — LLM 미연동(FR-30)이므로 서술형 문구를 규칙으로 만든다.
 * "자동 생성" 라벨을 붙여 사람이 쓴 문장과 구분한다 (FR-30 비고).
 */
function useSummary(farmId: string): { text: string; ready: boolean } {
  const { sensors, conns, robots, stops, snapshotReady } = useFarmData();

  // 값과 상태는 살아 있는 장치의 것만 말한다. 마지막으로 받은 값을 그대로 읽으면
  // 통신이 끊긴 뒤에도 「25.0℃ · 로봇 1대 작업 중」이 현재형으로 남는다 —
  // 하드웨어 목록은 전부 오프라인인데 요약만 정상인 것처럼 보인다.
  const fresh = (s: SensorValue | undefined) =>
    s && s.value != null && sensorLiveness(s.ts) === "online" ? s : undefined;
  const temp = fresh(Object.values(sensors).find((s) => s.sensor_type === "temperature"));
  const hum = fresh(Object.values(sensors).find((s) => s.sensor_type === "humidity"));
  const envPart =
    temp?.value != null && hum?.value != null
      ? `내부 ${temp.value.toFixed(1)}℃ · 습도 ${hum.value.toFixed(0)}%`
      : "환경 데이터 수신 중단";

  const all = Object.values(robots);
  const live = all.filter((r) => conns[r.device_id]?.state === "online");
  const working = live.filter((r) => r.phase === "working").length;
  const robotPart = controlBlocked(stops, farmId)
    ? "로봇 정지 중"
    : all.length === 0 ? "등록된 로봇 없음"
    : live.length === 0 ? "로봇 상태 확인 불가"
    : working ? `로봇 ${working}대 작업 중` : "로봇 대기 중";

  return {
    text: `${envPart} · ${robotPart}`,
    // 전체 스코프에서는 농장별 센서를 받지 않아, 상세 진입 직후 sensors 가 비어 있다
    ready: snapshotReady,
  };
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
        metric: "bg-[#F7F8FA]", advisory: "bg-[#F2F4F6] text-[#4E5968]",
      }
    : conditionCodes?.sky === 4
      ? {
          panel: "border-[#C7CDD4] bg-gradient-to-br from-[#D9DDE2] to-[#EEF0F2]",
          heading: "text-[#303841]", badge: "bg-white/80 text-[#56616D]",
          primary: "text-[#252B31]", secondary: "text-[#5D6873]",
          metric: "bg-white/90", advisory: "bg-[#59636E] text-white",
        }
      : isNight
        ? {
            panel: "border-black bg-gradient-to-br from-[#090D16] to-[#182235]",
            heading: "text-white", badge: "bg-white/15 text-[#E7F0FF]",
            primary: "text-white", secondary: "text-[#D8E5F7]",
            metric: "bg-white/95", advisory: "bg-black/70 text-white",
          }
        : {
            panel: "border-[#B9D5F8] bg-gradient-to-br from-[#D2E6FF] to-[#EAF4FF]",
            heading: "text-[#0B3D91]", badge: "bg-white text-[#1B64DA]",
            primary: "text-[#0B3D91]", secondary: "text-[#3A5A86]",
            metric: "bg-white", advisory: "bg-[#1B64DA] text-white",
          };
  const advisory = weather?.temperature_c != null && weather.temperature_c >= 30
    ? `외기 ${Math.round(weather.temperature_c)}℃ · 고온 상태 → 차광·환기 상태 확인 · 참고 정보 (제어는 현장에서)`
    : (weather?.precipitation_mm ?? 0) > 0
      ? `강수 ${weather?.precipitation_mm}mm → 개방 시설과 배수 상태 확인 · 참고 정보 (제어는 현장에서)`
      : "외부 기상 상태를 확인하세요 · 참고 정보 (제어는 현장에서)";

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

          <div className={`mt-3 rounded-xl px-3 py-2.5 text-12.5 font-extrabold leading-relaxed ${weatherTheme.advisory}`}>
            {advisory}
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

export default function StatusTab() {
  const { farmId } = useParams<{ farmId: string }>();
  const { sensors, conns, robots, stops } = useFarmData();
  const snap = useFarmSnapshot(farmId);
  const status = snap ? farmStatus(snap, stops) : null;
  const ranges = useRanges(farmId);
  const devices = useDevices(farmId);
  const summary = useSummary(farmId);

  const envSensors = Object.values(sensors).filter((s) => s.sensor_type !== "water_level");
  const byType = (t: string) => devices.filter((d) => d.device_type === t);

  return (
    <>
      {/* 상태 요약 + 날씨 */}
      <section className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle
            title="상태 요약"
            right={
              <span className="rounded-lg bg-status-info/10 px-2 py-0.5 text-11 font-extrabold text-status-infoDark">
                자동 생성
              </span>
            }
          />
          {/* 스냅샷 도착 전에는 자리만 잡는다 (확정 문구를 냈다가 바꾸면 깜빡인다) */}
          {summary.ready ? (
            <p className="text-14 font-semibold leading-relaxed text-gray-700">{summary.text}</p>
          ) : (
            <p aria-hidden="true" className="h-6 w-3/4 animate-pulse rounded bg-gray-100" />
          )}
          {/* 심각도별로 한 줄씩 — 지금 걸린 이슈를 등급별로 모아 보여준다.
              정지·엣지 문제가 센서 문제를 가리면 안 된다 (고치는 사람도 시점도 다르다) */}
          {summary.ready && (
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
                      {hit.map((reason) => (
                        <span
                          key={reason.text}
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
                  정상 · 정지·통신·센서 모두 이상 없음
                </div>
              )}
              {!status && (
                <div className="flex items-center gap-1.5 text-12 font-bold text-muted">
                  <span aria-hidden="true" className="inline-flex h-3 w-3 flex-none items-center justify-center">
                    <span className="h-2 w-2 rounded-full bg-gray-300" />
                  </span>
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

      {/* 배치도 + 하드웨어 */}
      <section className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><FarmMap farmId={farmId} robots={Object.values(robots)} /></div>
        <Card>
          <SectionTitle
            title="하드웨어" sub={`${devices.length}대`}
            right={
              // 이 농장의 장치 관리로 바로 — 설정 화면은 농장이 여럿이면 접혀 있다.
              // scroll={false} — Next 가 맨 위로 올리면 설정 화면의 정렬을 덮어쓴다
              <Link
                href={`/settings?farm=${farmId}&section=devices`}
                scroll={false}
                className={GO_LINK}
              >
                장치 관리
              </Link>
            }
          />
          {/* 전부 보여주고 넘치면 카드 안에서 스크롤한다 */}
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {[
              { type: "robot", label: "로봇", tab: "robot" },
              { type: "sensor", label: "센서", tab: "env" },
              { type: "tank", label: "탱크", tab: "supply" },
              { type: "station", label: "워크스테이션", tab: "supply" },
            ].map(({ type, label, tab }) => {
              const list = byType(type);
              if (list.length === 0) return null;
              return (
                <div key={type}>
                  <div className="mb-1 text-12 font-extrabold text-gray-500">
                    {label} {list.length}
                  </div>
                  <div className="space-y-1">
                    {list.map((d) => {
                      // 통신 상태는 FR-37 판정(deviceLiveness), 워크스테이션만 다른 축이라
                      // 작업 상태를 보여준다. 경과 시간은 붙이지 않는다 — 여기서 볼 것은
                      // 정상 여부뿐이고, 초 단위 숫자가 매 초 바뀌면 목록이 어수선해진다
                      const station = type === "station"
                        ? snap?.stations.find((s) => s.station_id === d.device_id)
                        : undefined;
                      const tank = type === "tank"
                        ? snap?.tanks.find((t) => t.device_id === d.device_id)
                        : undefined;
                      const live = deviceLiveness(
                        d.device_id, d.device_type, conns, sensors,
                        d.detail?.parent_device_id,
                      );
                      const badge = station
                        ? STATION_STATE[station.state] ?? STATION_STATE.idle
                        // 탱크는 발행 주체가 아니라 통신 축이 아니다 — 잔량을 보여준다
                        : type === "tank"
                          ? tankBadge(tank?.level_pct, live.state === "unmonitored" ? "offline" : live.state)
                        // 등록은 됐는데 한 번도 값이 오지 않은 장치
                        : live.state === "unmonitored"
                          ? { label: "데이터 없음", sev: "warning" }
                          : CONN_STYLE[live.state];
                      return (
                        <Link
                          key={d.device_id}
                          href={`/farms/${farmId}/${tab}`}
                          className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left text-12.5 hover:bg-surface"
                        >
                          <span className="min-w-0 flex-1 truncate font-bold">{d.name}</span>
                          {/* 상태는 줄이지 않는다 — 좁아지면 이름만 말줄임으로 양보한다 */}
                          <StatusDot sev={badge?.sev ?? "info"} label={badge?.label ?? "—"} />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {devices.length === 0 && (
              <div className="text-12.5 font-semibold text-muted">
                등록된 장비가 없어요. 설정에서 추가하세요.
              </div>
            )}
          </div>
        </Card>
      </section>

      {/* 환경 상태 게이지 (적정범위 = 알림 규칙) */}
      <section className="mb-5">
        <SectionTitle title="환경 상태" sub="적정 범위 대비 현재값 — 범위는 알림 규칙 기준" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {envSensors.map((s) => {
            const meta = SENSOR_META[s.sensor_type] ?? { name: s.sensor_type, unit: s.unit };
            const r = ranges[s.sensor_type];
            const lo = r?.min ?? null;
            const hi = r?.max ?? null;
            return (
              <Card key={s.sensor_id}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-13 font-bold text-gray-600">{meta.name}</span>
                  <span className="text-22 font-extrabold">
                    {s.value != null ? s.value.toFixed(1) : "—"}
                    <span className="ml-0.5 text-12 font-bold text-muted">{meta.unit}</span>
                  </span>
                </div>
                <Gauge
                  value={s.value}
                  min={lo != null ? lo - (hi != null ? (hi - lo) * 0.5 : 10) : 0}
                  max={hi != null ? hi + (lo != null ? (hi - lo) * 0.5 : 10) : 100}
                  okMin={lo} okMax={hi} unit={meta.unit}
                />
                <div className="mt-1 text-11.5 font-semibold text-muted">{timeAgo(s.ts)}</div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* 탱크 요약 (상세는 작업·공급 탭) */}
      {snap && snap.tanks.length > 0 && (
        <section>
          <SectionTitle
            title="탱크" sub="상세는 작업·공급 탭"
            right={
              <Link href={`/farms/${farmId}/supply`} className={GO_LINK}>
                작업·공급
              </Link>
            }
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {snap.tanks.map((t) => (
              <Card key={t.device_id}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-13 font-bold text-gray-600">
                    {TANK_LABEL[t.tank_type] ?? t.tank_type}
                  </span>
                  <span className="text-20 font-extrabold">
                    {t.level_pct != null ? Math.round(t.level_pct) : "—"}
                    <span className="text-12 font-bold text-muted">%</span>
                  </span>
                </div>
                <Gauge value={t.level_pct} okMin={TANK_LOW_PCT} okMax={100} compact />
                <div className="mt-1.5 text-11.5 font-semibold text-muted">
                  {t.remain_l != null ? `약 ${t.remain_l}L` : "—"}
                  {t.days_left != null && ` · ${t.days_left}일분`}
                  {t.uses_left != null && ` · ${t.uses_left}회분`}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
