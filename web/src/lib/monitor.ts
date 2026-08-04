"use client";

/**
 * 모니터링 데이터 훅 — 초기 로드는 REST(/api/...), 실시간은 WebSocket(/ws/monitor).
 * 둘 다 nginx 단일 진입점을 경유한다 (same-origin).
 * 통신 상태·마지막 수신 시각을 함께 유지한다 (FR-37, 페일세이프 ③).
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch, refreshToken } from "@/lib/api";

export interface SensorValue {
  sensor_id: string;
  sensor_type: string;
  unit: string;
  location?: string | null;
  value: number | null;
  ts: string | null;
  sensor_state: string;
}

export interface RobotValue {
  device_id: string;
  ts: string;
  pos_x: number | null;
  pos_y: number | null;
  speed: number | null;
  battery_pct: number | null;
  charging: boolean;
  mission_state: string;
}

export interface ConnState {
  device_id: string;
  state: "online" | "degraded" | "offline";
  last_received_at: string | null;
}

export interface FarmSummary {
  farm_id: string;
  name: string;
  farm_type: string;
  crop: string | null;
  devices_total: number;
  devices_online: number;
}

export interface StopInfo {
  scope: string | null;
  engaged_at: string;
  by?: string | null;
  reason?: string | null;
}

export interface StopState {
  remote: StopInfo | null;
  physical_estop: StopInfo | null;
}

export interface AlertItem {
  id: number;
  farm_id?: string;
  severity: "warning" | "caution" | "info";
  alert_kind: string;
  device_id: string | null;
  title: string;
  body: string | null;
  deeplink: string | null;
  occurred_at: string;
  acked_at: string | null;
}

/** 헤더 전용 전역 알림 — 현재 페이지의 농장 스코프와 무관하게 전체 알림을 유지한다. */
export function useGlobalAlerts(intervalMs = 15_000) {
  const [alerts, setAlerts] = useState<Record<number, AlertItem>>({});

  useEffect(() => {
    let active = true;

    const load = async () => {
      const res = await apiFetch("/api/alerts?limit=100");
      if (!res.ok || !active) return;
      const list: AlertItem[] = await res.json();
      setAlerts(Object.fromEntries(list.map((alert) => [alert.id, alert])));
    };

    void load();
    const timer = window.setInterval(() => void load(), intervalMs);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return alerts;
}
export interface CommandState {
  command_id: string;
  device_id: string;
  command?: string;
  params?: Record<string, unknown>;
  status: "issued" | "accepted" | "completed" | "failed" | "rejected" | "timeout";
  issued_at?: string;
}

export function useMonitor(scope: string) {
  const [farms, setFarms] = useState<FarmSummary[]>([]);
  const [sensors, setSensors] = useState<Record<string, SensorValue>>({});
  const [robots, setRobots] = useState<Record<string, RobotValue>>({});
  const [conns, setConns] = useState<Record<string, ConnState>>({});
  const [commands, setCommands] = useState<Record<string, CommandState>>({});
  const [alerts, setAlerts] = useState<Record<number, AlertItem>>({});
  const [stops, setStops] = useState<StopState>({ remote: null, physical_estop: null });
  const [farmName, setFarmName] = useState("");
  const [wsOpen, setWsOpen] = useState(false);

  // ── 초기 로드 (REST) ──
  const loadSnapshot = useCallback(async (farmId: string) => {
    const res = await apiFetch(`/api/farms/${farmId}/snapshot`);
    if (!res.ok) return;
    const snap = await res.json();
    setFarmName(snap.farm.name);
    setSensors(Object.fromEntries(snap.sensors.map((s: SensorValue) => [s.sensor_id, s])));
    setRobots(Object.fromEntries(snap.robots.map((r: RobotValue) => [r.device_id, r])));
    setConns(Object.fromEntries(snap.connections.map((c: ConnState) => [c.device_id, c])));
  }, []);

  useEffect(() => {
    apiFetch("/api/farms").then(async (r) => r.ok && setFarms(await r.json()));
    if (scope === "all") {
      // 전체 스코프 — 전 농장 알림 (fleet KPI·전역 벨·/alerts)
      apiFetch("/api/alerts?limit=100").then(async (r) => {
        if (!r.ok) return;
        const list: AlertItem[] = await r.json();
        setAlerts(Object.fromEntries(list.map((a) => [a.id, a])));
      });
    }
    if (scope !== "all") {
      void loadSnapshot(scope);
      apiFetch(`/api/farms/${scope}/commands`).then(async (r) => {
        if (!r.ok) return;
        const list: CommandState[] = await r.json();
        setCommands(Object.fromEntries(list.map((c) => [c.command_id, c])));
      });
      apiFetch(`/api/farms/${scope}/alerts?limit=50`).then(async (r) => {
        if (!r.ok) return;
        const list: AlertItem[] = await r.json();
        setAlerts(Object.fromEntries(list.map((a) => [a.id, a])));
      });
      apiFetch(`/api/farms/${scope}/stop-state`).then(async (r) => r.ok && setStops(await r.json()));
    }
  }, [scope, loadSnapshot]);

  // ── 실시간 (WebSocket) ──
  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null;

    const onMessage = (ev: MessageEvent) => {
      const msg = JSON.parse(ev.data);
      if (msg.type !== "update") return;
      const d = msg.data;
      if (msg.stream === "environment") {
        setSensors((prev) => ({
          ...prev,
          [d.sensor_id]: { ...prev[d.sensor_id], ...d, ts: d.ts },
        }));
        // 데이터 수신 자체가 해당 장치 online 의 증거
        setConns((prev) => ({
          ...prev,
          [d.device_id]: { device_id: d.device_id, state: "online", last_received_at: msg.timestamp },
        }));
      } else if (msg.stream === "robot") {
        setRobots((prev) => ({ ...prev, [d.device_id]: { ...prev[d.device_id], ...d } }));
        setConns((prev) => ({
          ...prev,
          [d.device_id]: { device_id: d.device_id, state: "online", last_received_at: msg.timestamp },
        }));
      } else if (msg.stream === "stop") {
        // 원격/물리 정지는 독립 표시 — 동시 성립 가능 (non-functional §2.4)
        setStops((prev) => ({
          ...prev,
          [d.stop_kind as "remote" | "physical_estop"]: d.active
            ? { scope: d.scope, engaged_at: d.engaged_at, by: d.by, reason: d.reason }
            : null,
        }));
      } else if (msg.stream === "alert") {
        setAlerts((prev) => {
          if (d.ack_all) {
            const next: typeof prev = {};
            for (const k of Object.keys(prev)) {
              const id = Number(k);
              next[id] = { ...prev[id], acked_at: prev[id].acked_at ?? d.acked_at };
            }
            return next;
          }
          return { ...prev, [d.id]: { ...prev[d.id], ...d } };
        });
      } else if (msg.stream === "command") {
        // 접수(accepted)/완료(completed) 구분 표시의 근거 (FR-10, 비기능 §4)
        setCommands((prev) => ({
          ...prev,
          [d.command_id]: { issued_at: msg.timestamp, ...prev[d.command_id], ...d },
        }));
      } else if (msg.stream === "connection") {
        setConns((prev) => {
          if (d.cascade) {
            // 엣지 단절 — 농장 전체 오프라인 (페일세이프 ②의 화면 반영)
            const next: typeof prev = {};
            for (const k of Object.keys(prev)) next[k] = { ...prev[k], state: "offline" };
            return next;
          }
          return { ...prev, [d.device_id]: { ...prev[d.device_id], ...d } };
        });
      }
    };

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const sock = new WebSocket(`${proto}//${location.host}/ws/monitor`);
      ws = sock;
      sock.onopen = () => {
        retry = 0;
        setWsOpen(true);
        sock.send(JSON.stringify({ action: "subscribe", scope }));
      };
      // 핸드셰이크 인증은 쿠키 — 만료로 거부되면 갱신 후 재연결 (지수 백오프)
      sock.onclose = async (ev) => {
        setWsOpen(false);
        if (closed) return;
        if (ev.code !== 1000) await refreshToken();
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
      };
      sock.onmessage = onMessage;
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [scope]);

  return { farms, farmName, sensors, robots, conns, commands, alerts, stops, wsOpen };
}

export async function engageStop(reason?: string) {
  const r = await apiFetch("/api/stop", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "all", reason }),
  });
  return r.ok;
}

export async function releaseStop() {
  const r = await apiFetch("/api/stop/release", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "all" }),
  });
  return r.ok;
}

export async function ackAlert(id: number) {
  await apiFetch(`/api/alerts/${id}/ack`, { method: "POST" });
}

export async function ackAllAlerts(farmId: string) {
  await apiFetch(`/api/farms/${farmId}/alerts/ack-all`, { method: "POST" });
}

/** 제어 명령 발행 (FR-10) — command_id 를 반환한다. */
export async function postControl(
  farmId: string, deviceId: string, command: string, target: number,
): Promise<string | null> {
  const res = await apiFetch(`/api/farms/${farmId}/devices/${deviceId}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, params: { target } }),
  });
  if (!res.ok) return null;
  return (await res.json()).command_id;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 10) return "방금";
  if (sec < 60) return `${Math.floor(sec)}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return `${Math.floor(sec / 3600)}시간 전`;
}
