"use client";

/**
 * 통합 대시보드 MVP (증분 3) — FR-04·08·38.
 * 디자인 전달본(docs/design)의 대시보드 A(전체)/농장 상세·생육기 화면 참조:
 * 카드형 KPI, 상태 점 표기(색+도형 병기), 강조 수치 22px+, 통신 상태 상시 표시.
 */

import { useState } from "react";
import { AlertPanel } from "@/components/AlertPanel";
import { AlertRules } from "@/components/AlertRules";
import { ControlPanel } from "@/components/ControlPanel";
import { ROLE_LABEL, canControl, logout, useUser } from "@/lib/auth";
import { timeAgo, useMonitor } from "@/lib/monitor";

const SENSOR_LABEL: Record<string, { name: string; unit: string }> = {
  temperature: { name: "온도", unit: "℃" },
  humidity: { name: "습도", unit: "%" },
  ec: { name: "양분(EC)", unit: "" },
  co2: { name: "CO₂", unit: "ppm" },
  illuminance: { name: "조도", unit: "klx" },
  power: { name: "소모전력", unit: "kW" },
};

const CONN_LABEL: Record<string, { text: string; cls: string; dot: string }> = {
  online: { text: "정상", cls: "text-status-ok", dot: "bg-status-ok" },
  degraded: { text: "응답 지연", cls: "text-status-cautionDark", dot: "bg-status-caution" },
  offline: { text: "오프라인", cls: "text-status-warningDark", dot: "bg-status-warning" },
};

const MISSION_LABEL: Record<string, string> = {
  idle: "대기", moving: "이동 중", working: "작업 중", charging: "충전 중", error: "이상",
};

function ConnBadge({ state }: { state?: string }) {
  const c = CONN_LABEL[state ?? "offline"];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-bold ${c.cls}`}>
      <span className={`h-2 w-2 rounded-full ${c.dot}`} />
      {c.text}
    </span>
  );
}

export default function Dashboard() {
  const [scope, setScope] = useState<string>("seongju"); // 2차년도 기본: 농장 1개
  const { farms, farmName, sensors, robots, conns, commands, alerts, wsOpen } = useMonitor(scope);
  const user = useUser();

  const edgeConn = conns["edge-01"];
  const farmOnline = edgeConn?.state === "online";

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      {/* ── 상단: 스코프 스위처 + 연결 상태 ── */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-extrabold">팜온 스마트팜 HMI</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setScope("all")}
            className={`rounded-xl border px-4 py-2 text-sm font-bold ${
              scope === "all" ? "border-primary bg-primary text-white" : "border-gray-200 bg-white text-gray-600"
            }`}
          >
            전체 현황
          </button>
          {farms.map((f) => (
            <button
              key={f.farm_id}
              onClick={() => setScope(f.farm_id)}
              className={`rounded-xl border px-4 py-2 text-sm font-bold ${
                scope === f.farm_id ? "border-primary bg-primary text-white" : "border-gray-200 bg-white text-gray-600"
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted">
          <span className={`h-2 w-2 rounded-full ${wsOpen ? "bg-status-ok" : "bg-status-warning"}`} />
          {wsOpen ? "실시간 연결됨" : "실시간 연결 끊김"}
        </span>
        {user && (
          <span className="flex items-center gap-2">
            {scope !== "all" && <AlertPanel farmId={scope} alerts={alerts} />}
            <span className="rounded-xl bg-white px-3 py-1.5 text-[13px] font-bold shadow-sm">
              {user.name}
              <span className="ml-1.5 rounded-md bg-primary-bg px-1.5 py-0.5 text-[11px] font-extrabold text-primary-dark">
                {ROLE_LABEL[user.role]}
              </span>
            </span>
            <button onClick={logout} className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-bold text-gray-500">
              로그아웃
            </button>
          </span>
        )}
      </div>

      {scope === "all" ? (
        /* ── 전체 현황 (FR-38) ── */
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {farms.map((f) => (
            <button
              key={f.farm_id}
              onClick={() => setScope(f.farm_id)}
              className="rounded-2xl bg-white p-5 text-left shadow-sm"
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    f.devices_online === f.devices_total ? "bg-status-ok" : f.devices_online > 0 ? "bg-status-caution" : "bg-status-warning"
                  }`}
                />
                <span className="text-[17px] font-extrabold">{f.name}</span>
              </div>
              <div className="text-[13px] font-semibold text-muted">
                {f.farm_type === "greenhouse" ? "온실" : f.farm_type} · {f.crop ?? "—"}
              </div>
              <div className="mt-3 text-[22px] font-extrabold">
                {f.devices_online}
                <span className="text-[14px] font-bold text-muted"> / {f.devices_total} 장치 온라인</span>
              </div>
            </button>
          ))}
        </section>
      ) : (
        <>
          {/* ── 농장 헤더 ── */}
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-lg font-extrabold">{farmName || scope}</h2>
            <ConnBadge state={edgeConn?.state} />
            {!farmOnline && (
              <span className="text-[13px] font-semibold text-muted">
                마지막 수신 {timeAgo(edgeConn?.last_received_at ?? null)}
              </span>
            )}
          </div>

          {/* ── 실시간 환경값 (FR-08) ── */}
          <section id="env" className="mb-6">
            <h3 className="mb-3 text-[15px] font-extrabold">
              실시간 환경값 <span className="font-semibold text-muted">· 센서 {Object.keys(sensors).length}대 집계</span>
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Object.values(sensors).map((s) => {
                const meta = SENSOR_LABEL[s.sensor_type] ?? { name: s.sensor_type, unit: s.unit };
                const stale = !farmOnline;
                return (
                  <div key={s.sensor_id} className={`rounded-2xl bg-white p-4 shadow-sm ${stale ? "opacity-60" : ""}`}>
                    <div className="text-[13px] font-bold text-gray-500">{meta.name}</div>
                    <div className="mt-1 text-[22px] font-extrabold">
                      {s.value != null ? s.value.toFixed(1) : "—"}
                      <span className="ml-0.5 text-[12px] font-bold text-muted">{meta.unit}</span>
                    </div>
                    <div className="mt-1 text-[11.5px] font-semibold text-muted">{timeAgo(s.ts)}</div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── 환경 제어 (FR-10) — viewer 는 조회 전용 ── */}
          <ControlPanel
            farmId={scope} deviceId="growbed-01" commands={commands}
            disabled={!farmOnline || !canControl(user)}
            disabledReason={!farmOnline ? "통신 단절 — 제어를 사용할 수 없습니다" : !canControl(user) ? "조회 전용 계정 — 제어 권한이 없습니다" : undefined}
          />

          {/* ── 로봇 상태 (FR-04) ── */}
          <section id="robot" className="mb-6">
            <h3 className="mb-3 text-[15px] font-extrabold">
              로봇 <span className="font-semibold text-muted">· {Object.keys(robots).length}대 · 위치·속도·전원 실시간</span>
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Object.values(robots).map((r) => (
                <div key={r.device_id} className="rounded-2xl bg-white p-5 shadow-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[15px] font-extrabold">{r.device_id}</span>
                    <span className="rounded-lg bg-primary-bg px-2 py-0.5 text-[12px] font-extrabold text-primary-dark">
                      {MISSION_LABEL[r.mission_state] ?? r.mission_state}
                    </span>
                    <ConnBadge state={conns[r.device_id]?.state} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[13px] font-semibold text-gray-600">
                    <div>
                      배터리 <b className={`${(r.battery_pct ?? 0) < 30 ? "text-status-warningDark" : ""}`}>{r.battery_pct ?? "—"}%</b>
                      {r.charging && <span className="text-status-infoDark"> ⚡충전</span>}
                    </div>
                    <div>속도 <b>{r.speed?.toFixed(1) ?? "—"}㎧</b></div>
                    <div>위치 <b>({r.pos_x?.toFixed(1) ?? "—"}, {r.pos_y?.toFixed(1) ?? "—"})</b></div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── 알림 규칙 (FR-34) ── */}
          <AlertRules farmId={scope} editable={canControl(user)} />

          {/* ── 장치 통신 상태 (FR-37) ── */}
          <section id="conn">
            <h3 className="mb-3 text-[15px] font-extrabold">장치 통신 상태</h3>
            <div className="rounded-2xl bg-white p-2 shadow-sm">
              {Object.values(conns).map((c) => (
                <div key={c.device_id} className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5 text-[13.5px] last:border-0">
                  <span className="font-bold">{c.device_id}</span>
                  <span className="flex items-center gap-3">
                    <span className="font-semibold text-muted">마지막 수신 {timeAgo(c.last_received_at)}</span>
                    <ConnBadge state={c.state} />
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
