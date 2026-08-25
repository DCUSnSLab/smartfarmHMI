"use client";

/**
 * 통합 대시보드 A — 전체 현황 (디자인 전달본 "통합 대시보드 A (전체)").
 * Fleet KPI · 농장별 현황 카드 · 전체 알림 · 오늘 작업.
 * (기존 MVP 의 농장별 내용은 /farms/[farmId]/[tab] 로 이관)
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PlannedBox, PlannedChip } from "@/components/Planned";
import {
  Card, Gauge, GO_LINK, KpiTile, SectionTitle, StatusDot, StatusMark,
} from "@/components/ui";
import { SENSOR_META, SEV_STYLE, TANK_LABEL } from "@/lib/severity";
import { useFarmData, useScope } from "@/lib/farmData";
import { FarmSnapshot, farmStatus, sensorOf } from "@/lib/fleet";
import { timeAgo, type StopState } from "@/lib/monitor";
import { isValidWeatherLocation, weatherConditionLabel, weatherIcon, type WeatherRow } from "@/lib/weather";

const KPI_SENSORS = ["temperature", "humidity", "co2"] as const;

function FarmCard({
  snap,
  stops,
  weather,
}: {
  snap: FarmSnapshot;
  stops: StopState;
  weather?: WeatherRow;
}) {
  const router = useRouter();
  const status = farmStatus(snap, stops);
  const s = SEV_STYLE[status.sev];
  const weatherTitle = weather?.ts
    ? [
        weatherConditionLabel(weather.condition),
        weather.humidity_pct != null ? `습도 ${Math.round(weather.humidity_pct)}%` : null,
        weather.precipitation_mm != null ? `강수 ${weather.precipitation_mm}mm` : null,
        weather.wind_ms != null ? `풍속 ${weather.wind_ms}m/s` : null,
      ].filter(Boolean).join(" · ")
    : isValidWeatherLocation(weather?.latitude ?? null, weather?.longitude ?? null)
      ? "기상 정보를 불러오는 중입니다."
      : weather?.latitude != null || weather?.longitude != null
        ? "정보 없음"
        : "날씨 조회 위치가 설정되지 않았습니다.";

  return (
    <Card
      className="flex h-full flex-col justify-start"
      onClick={() => router.push(`/farms/${snap.farm.farm_id}/status`)}
    >
      <div className="mb-3 flex items-center gap-2">
        <StatusMark sev={status.sev} label={status.label} />
        <span className="min-w-0 flex-1 truncate text-16 font-extrabold">{snap.farm.name}</span>
        <span
          title={weatherTitle}
          className="flex flex-none items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-12 font-extrabold text-gray-700"
        >
          {weather?.ts ? (
            <>
              <span className="text-15 leading-none" aria-hidden="true">
                {weatherIcon(weather.condition)}
              </span>
              <span>{weather.temperature_c != null ? `${weather.temperature_c.toFixed(1)}°` : "—"}</span>
            </>
          ) : (
            <span>{(weather?.latitude != null || weather?.longitude != null)
              && !isValidWeatherLocation(weather.latitude, weather.longitude) ? "정보 없음" : "날씨 —"}</span>
          )}
        </span>
        <span
          title={status.reasons.map((r) => r.text).join(" · ") || undefined}
          className={`rounded-lg px-2 py-0.5 text-11.5 font-extrabold ${s.bg} ${s.text}`}
        >
          {status.label}
        </span>
      </div>

      <div className="mb-3 text-12.5 font-semibold text-muted">
        {snap.farm.farm_type === "greenhouse" ? "온실" : snap.farm.farm_type === "plant_factory" ? "식물공장" : "노지"}
        {snap.farm.crop ? ` · ${snap.farm.crop}` : ""}
        {" · 장치 "}
        {snap.connections.filter((c) => c.state === "online").length}/{snap.connections.length}
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 border-b border-gray-100 pb-3">
        {KPI_SENSORS.map((type) => {
          const sensor = sensorOf(snap, type);
          const meta = SENSOR_META[type];
          return (
            <div key={type}>
              <div className="text-20 font-extrabold leading-tight">
                {sensor?.value != null ? sensor.value.toFixed(type === "co2" ? 0 : 1) : "—"}
                <span className="ml-0.5 text-11 font-bold text-muted">{meta.unit}</span>
              </div>
              <div className="text-11.5 font-semibold text-muted">{meta.name}</div>
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5">
        {snap.tanks.map((t) => (
          <div key={t.device_id} className="flex items-center gap-2">
            <span className="w-12 flex-none whitespace-nowrap text-11.5 font-bold text-gray-500">
              {TANK_LABEL[t.tank_type] ?? t.tank_type}
            </span>
            <span className="flex-1">
              <Gauge value={t.level_pct} compact />
            </span>
            <span className="w-10 flex-none whitespace-nowrap text-right text-11.5 font-extrabold">
              {t.level_pct != null ? `${Math.round(t.level_pct)}%` : "—"}
            </span>
          </div>
        ))}
        {snap.tanks.length === 0 && (
          <span className="text-11.5 font-semibold text-muted">등록된 탱크 없음</span>
        )}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  useScope("all");
  const { farms, alerts, wsOpen, snaps, stops, weather: weatherRows } = useFarmData();
  const weatherByFarm = new Map(weatherRows.map((row) => [row.farm_id, row]));

  const alertList = Object.values(alerts);
  const unacked = alertList.filter((a) => !a.acked_at);

  const snapList = Object.values(snaps);
  const sevCount = { ok: 0, caution: 0, warning: 0 };
  for (const snap of snapList) {
    sevCount[farmStatus(snap, stops).sev] += 1;
  }
  // 스냅샷이 아직 안 온 농장 — 합계가 농장 수와 어긋나 보이지 않게 따로 센다
  const pending = farms.length - snapList.length;
  const robots = snapList.flatMap((s) => s.robots);
  const activeRobots = robots.filter((r) => r.phase === "moving" || r.phase === "working");
  const charging = robots.filter((r) => r.charging || r.phase === "charging");
  // 오류는 진행 단계와 별개 축이다 — 이동 중에도 오류일 수 있다 (§4.2).
  const errored = robots.filter((r) => r.error != null);

  const dateLabel = new Date().toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-22 font-extrabold">전체 현황</h1>
        <span className="text-13.5 font-bold text-muted">스마트팜 {farms.length}곳</span>
        <span className="text-13 font-semibold text-muted">{dateLabel}</span>
        <span className="ml-auto flex items-center gap-1.5 text-12.5 font-semibold text-muted">
          <StatusMark sev={wsOpen ? "ok" : "warning"} label={wsOpen ? "실시간 연결됨" : "실시간 연결 끊김"} />
          {wsOpen ? "실시간 연결됨" : "실시간 연결 끊김"}
        </span>
      </div>

      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="운영 농장" value={farms.length} unit="곳"
          detail={`정상 ${sevCount.ok} · 주의 ${sevCount.caution} · 경고 ${sevCount.warning}`
            + (pending > 0 ? ` · 확인 중 ${pending}` : "")}
        />
        <KpiTile
          label="가동 로봇" value={`${activeRobots.length} / ${robots.length}`} unit="대"
          detail={`충전 중 ${charging.length} · 이상 ${errored.length}`}
        />
        <KpiTile
          label="오늘 작업" value="—"
          detail={<PlannedChip basis="증분 8 스케줄" />}
        />
        <KpiTile
          label="미확인 알림" value={unacked.length} unit="건"
          tone={unacked.some((a) => a.severity === "warning") ? "warning" : "default"}
          detail={`경고 ${unacked.filter((a) => a.severity === "warning").length} · 주의 ${unacked.filter((a) => a.severity === "caution").length}`}
        />
      </section>

      <section className="mb-6">
        <SectionTitle title="농장별 현황" sub="카드를 누르면 농장 상세로 이동해요" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {farms.map((f) => {
            const snap = snaps[f.farm_id];
            return snap ? (
              <FarmCard
                key={f.farm_id}
                snap={snap}
                stops={stops}
                weather={weatherByFarm.get(f.farm_id)}
              />
            ) : (
              <Card key={f.farm_id}>
                <div className="text-16 font-extrabold">{f.name}</div>
                <div className="mt-2 text-12.5 font-semibold text-muted">불러오는 중…</div>
              </Card>
            );
          })}
          {farms.length === 0 && (
            <Card>
              <div className="text-14 font-bold">등록된 농장이 없어요</div>
              <div className="mt-1 text-12.5 font-semibold text-muted">
                설정 화면에서 농장을 추가하거나, 데이터가 들어온 미등록 농장을 등록하세요.
              </div>
              <Link href="/settings" className="mt-3 inline-block rounded-xl bg-primary px-4 py-2 text-13 font-extrabold text-white">
                설정으로 이동
              </Link>
            </Card>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle
            title="전체 알림" sub={`미확인 ${unacked.length}건`}
            right={<Link href="/alerts" className={GO_LINK}>모두 보기</Link>}
          />
          {alertList.length === 0 && (
            <div className="py-6 text-center text-13 font-semibold text-muted">알림이 없어요</div>
          )}
          {alertList
            .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
            .slice(0, 5)
            .map((a) => (
              <Link
                key={a.id} href={a.deeplink?.startsWith("/") ? a.deeplink : "/alerts"}
                className={`flex items-center gap-2.5 border-b border-gray-50 py-2.5 last:border-0 ${a.acked_at ? "opacity-50" : ""}`}
              >
                <StatusMark sev={a.severity} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-13.5 font-bold">
                    {a.farm_id && <span className="mr-1.5 text-muted">{a.farm_id}</span>}
                    {a.title}
                  </span>
                </span>
                <span className="flex-none text-11.5 font-semibold text-muted">
                  {timeAgo(a.occurred_at)}
                </span>
              </Link>
            ))}
        </Card>

        <div className="space-y-4">
          <PlannedBox feature="오늘 예정 작업" basis="증분 8 · FR-19·03">
            작업 스케줄과 로봇 임무가 구현되면 오늘 예정된 양액·급수·방재 작업이 시간순으로 표시됩니다.
          </PlannedBox>
          <Card>
            <SectionTitle title="장치 통신" sub="전 농장" />
            <div className="space-y-1.5">
              {snapList.map((snap) => {
                const on = snap.connections.filter((c) => c.state === "online").length;
                const total = snap.connections.length;
                return (
                  <div key={snap.farm.farm_id} className="flex items-center gap-2 text-12.5">
                    <span className="min-w-0 flex-1 truncate font-bold">{snap.farm.name}</span>
                    <StatusDot
                      sev={on === total ? "ok" : on > 0 ? "caution" : "warning"}
                      label={`${on}/${total}`}
                    />
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </section>
    </main>
  );
}
