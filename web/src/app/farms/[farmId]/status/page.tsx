"use client";

/**
 * 농장 상세 · 상태 (디자인 "농장 상세: 상태").
 * 상태 요약 · 지역 날씨(Planned) · 실시간 배치도 · 하드웨어 리스트 · 환경 상태 게이지
 */

import { useParams, useRouter } from "next/navigation";
import { PlannedChip } from "@/components/Planned";
import {
  Card, CONN_STYLE, Gauge, SectionTitle, StatusDot,
  MISSION_LABEL, SENSOR_META, TANK_LABEL,
} from "@/components/ui";
import { useFarmData } from "@/lib/farmData";
import { useDevices, useFarmSnapshot, useRanges } from "@/lib/farmDetail";
import { timeAgo } from "@/lib/monitor";
import { useWeather, weatherIcon } from "@/lib/weather";

/**
 * 규칙 기반 상태 요약 — LLM 미연동(FR-30)이므로 서술형 문구를 규칙으로 만든다.
 * "자동 생성" 라벨을 붙여 사람이 쓴 문장과 구분한다 (FR-30 비고).
 */
function useSummary(): { text: string; issues: string[] } {
  const { sensors, conns, robots } = useFarmData();
  const issues: string[] = [];

  const offline = Object.values(conns).filter((c) => c.state === "offline");
  const degraded = Object.values(conns).filter((c) => c.state === "degraded");
  if (offline.length) issues.push(`${offline.map((c) => c.device_id).join(", ")} 통신 단절`);
  if (degraded.length) issues.push(`${degraded.map((c) => c.device_id).join(", ")} 응답 지연`);

  const lowBattery = Object.values(robots).filter((r) => (r.battery_pct ?? 100) < 30);
  if (lowBattery.length) issues.push(`${lowBattery.map((r) => r.device_id).join(", ")} 배터리 부족`);

  const temp = Object.values(sensors).find((s) => s.sensor_type === "temperature");
  const hum = Object.values(sensors).find((s) => s.sensor_type === "humidity");
  const envPart =
    temp?.value != null && hum?.value != null
      ? `내부 ${temp.value.toFixed(1)}℃ · 습도 ${hum.value.toFixed(0)}%`
      : "환경 데이터 수신 대기";

  const working = Object.values(robots).filter((r) => r.mission_state === "working").length;
  const robotPart = working ? `로봇 ${working}대 작업 중` : "로봇 대기 중";

  return {
    text: issues.length
      ? `${envPart} · ${robotPart} · 확인 필요: ${issues.join(", ")}`
      : `${envPart} · ${robotPart} · 특이사항 없음`,
    issues,
  };
}

function FarmWeather({ farmId }: { farmId: string }) {
  const { rows, loading } = useWeather();
  const weather = rows.find((row) => row.farm_id === farmId);

  return (
    <Card>
      <SectionTitle
        title="지역 날씨"
        sub="농장 외부 기상"
        right={weather?.received_at && (
          <span className="text-[11px] font-semibold text-muted">{timeAgo(weather.received_at)} 갱신</span>
        )}
      />
      {loading ? (
        <div className="py-7 text-center text-[12.5px] font-semibold text-muted">날씨를 불러오는 중…</div>
      ) : weather?.ts ? (
        <>
          <div className="flex items-end gap-3">
            <span className="text-[30px]" aria-hidden="true">
              {weatherIcon(weather.condition, weather.precipitation_mm)}
            </span>
            <span className="text-[30px] font-extrabold leading-none">
              {weather.temperature_c != null ? weather.temperature_c.toFixed(1) : "—"}
              <span className="ml-0.5 text-[14px] font-bold text-muted">℃</span>
            </span>
            <span className="pb-0.5 text-[13px] font-extrabold text-gray-600">{weather.condition ?? "정보 없음"}</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-gray-50 px-2 py-2 text-center">
              <div className="text-[11px] font-semibold text-muted">습도</div>
              <div className="mt-0.5 text-[14px] font-extrabold">
                {weather.humidity_pct != null ? `${Math.round(weather.humidity_pct)}%` : "—"}
              </div>
            </div>
            <div className="rounded-xl bg-gray-50 px-2 py-2 text-center">
              <div className="text-[11px] font-semibold text-muted">1시간 강수</div>
              <div className="mt-0.5 text-[14px] font-extrabold">
                {weather.precipitation_mm != null ? `${weather.precipitation_mm}mm` : "—"}
              </div>
            </div>
            <div className="rounded-xl bg-gray-50 px-2 py-2 text-center">
              <div className="text-[11px] font-semibold text-muted">풍속</div>
              <div className="mt-0.5 text-[14px] font-extrabold">
                {weather.wind_ms != null ? `${weather.wind_ms}m/s` : "—"}
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-between text-[10.5px] font-semibold text-muted">
            <span>관측 {new Date(weather.ts).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            <span>기상청 초단기실황</span>
          </div>
        </>
      ) : (
        <div className="py-6 text-center text-[12.5px] font-semibold text-muted">
          {weather?.region_code ? "기상 정보를 준비 중입니다." : "날씨 조회 위치가 설정되지 않았습니다."}
        </div>
      )}
    </Card>
  );
}

/**
 * 간이 실시간 배치도 — 좌표계가 확정되지 않아(OPN-21) 논리 배치로 표현한다.
 * 로봇은 pos_x/pos_y 를 관측 범위로 정규화해 상대 위치만 보여준다.
 */
function Layout2D() {
  const { robots } = useFarmData();
  const list = Object.values(robots);
  const xs = list.map((r) => r.pos_x ?? 0);
  const ys = list.map((r) => r.pos_y ?? 0);
  const minX = Math.min(0, ...xs), maxX = Math.max(10, ...xs);
  const minY = Math.min(0, ...ys), maxY = Math.max(6, ...ys);

  return (
    <Card>
      <SectionTitle
        title="실시간 배치도" sub="로봇 위치는 상대 표시"
        right={<PlannedChip basis="OPN-21 좌표계 협의" />}
      />
      <div className="relative h-[220px] overflow-hidden rounded-2xl bg-surface">
        {/* 논리 구역 — 좌표계 확정 시 실제 도면으로 교체 */}
        <div className="absolute left-3 top-3 flex gap-2">
          {["A동 랙", "B동 랙", "작업 구역"].map((zone) => (
            <span key={zone} className="rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-bold text-gray-500 shadow-sm">
              {zone}
            </span>
          ))}
        </div>
        {list.map((r) => {
          const left = ((r.pos_x ?? 0) - minX) / (maxX - minX || 1);
          const top = ((r.pos_y ?? 0) - minY) / (maxY - minY || 1);
          return (
            <span
              key={r.device_id}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11.5px] font-extrabold text-white shadow transition-all duration-1000"
              style={{ left: `${12 + left * 76}%`, top: `${30 + top * 55}%` }}
            >
              🤖 {r.device_id}
              {r.charging && <span>⚡</span>}
            </span>
          );
        })}
        {list.length === 0 && (
          <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-muted">
            로봇 데이터가 없어요
          </span>
        )}
      </div>
    </Card>
  );
}

export default function StatusTab() {
  const { farmId } = useParams<{ farmId: string }>();
  const router = useRouter();
  const { sensors, robots, conns } = useFarmData();
  const snap = useFarmSnapshot(farmId);
  const ranges = useRanges(farmId);
  const devices = useDevices(farmId);
  const summary = useSummary();

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
              <span className="rounded-lg bg-status-info/10 px-2 py-0.5 text-[11px] font-extrabold text-status-infoDark">
                자동 생성
              </span>
            }
          />
          <p className="text-[14px] font-semibold leading-relaxed text-gray-700">{summary.text}</p>
          {summary.issues.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {summary.issues.map((i) => (
                <span key={i} className="rounded-lg bg-status-caution/10 px-2.5 py-1 text-[12px] font-bold text-status-cautionDark">
                  {i}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11.5px] font-semibold text-muted">
            규칙 기반 요약입니다. LLM 연동 후 서술형 분석·조치 권고로 확장됩니다 (FR-30).
          </p>
        </Card>
        <FarmWeather farmId={farmId} />
      </section>

      {/* 배치도 + 하드웨어 */}
      <section className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><Layout2D /></div>
        <Card>
          <SectionTitle title="하드웨어" sub={`${devices.length}대`} />
          <div className="space-y-3">
            {[
              { type: "robot", label: "로봇" },
              { type: "sensor", label: "센서" },
              { type: "tank", label: "탱크" },
              { type: "station", label: "워크스테이션" },
            ].map(({ type, label }) => {
              const list = byType(type);
              if (list.length === 0) return null;
              return (
                <div key={type}>
                  <div className="mb-1 text-[12px] font-extrabold text-gray-500">
                    {label} {list.length}
                  </div>
                  <div className="space-y-1">
                    {list.slice(0, 4).map((d) => {
                      const c = conns[d.device_id];
                      return (
                        <div key={d.device_id} className="flex items-center gap-2 text-[12.5px]">
                          <span className="min-w-0 flex-1 truncate font-bold">{d.name}</span>
                          {c ? (
                            <StatusDot sev={CONN_STYLE[c.state]?.sev ?? "info"} label={CONN_STYLE[c.state]?.label} />
                          ) : (
                            <span className="text-[11.5px] font-semibold text-muted">—</span>
                          )}
                        </div>
                      );
                    })}
                    {list.length > 4 && (
                      <button
                        onClick={() => router.push("/settings")}
                        className="text-[11.5px] font-bold text-primary-dark"
                      >
                        +{list.length - 4}대 더 보기 (설정)
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {devices.length === 0 && (
              <div className="text-[12.5px] font-semibold text-muted">
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
                  <span className="text-[13px] font-bold text-gray-600">{meta.name}</span>
                  <span className="text-[22px] font-extrabold">
                    {s.value != null ? s.value.toFixed(1) : "—"}
                    <span className="ml-0.5 text-[12px] font-bold text-muted">{meta.unit}</span>
                  </span>
                </div>
                <Gauge
                  value={s.value}
                  min={lo != null ? lo - (hi != null ? (hi - lo) * 0.5 : 10) : 0}
                  max={hi != null ? hi + (lo != null ? (hi - lo) * 0.5 : 10) : 100}
                  okMin={lo} okMax={hi} unit={meta.unit}
                />
                <div className="mt-1 text-[11.5px] font-semibold text-muted">{timeAgo(s.ts)}</div>
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
              <button
                onClick={() => router.push(`/farms/${farmId}/supply`)}
                className="text-[12.5px] font-bold text-primary-dark"
              >
                작업·공급 →
              </button>
            }
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {snap.tanks.map((t) => (
              <Card key={t.device_id}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[13px] font-bold text-gray-600">
                    {TANK_LABEL[t.tank_type] ?? t.tank_type}
                  </span>
                  <span className="text-[20px] font-extrabold">
                    {t.level_pct != null ? Math.round(t.level_pct) : "—"}
                    <span className="text-[12px] font-bold text-muted">%</span>
                  </span>
                </div>
                <Gauge value={t.level_pct} compact />
                <div className="mt-1.5 text-[11.5px] font-semibold text-muted">
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
