"use client";

/**
 * 모니터링 데이터 훅 — 초기 로드는 REST(/api/...), 실시간은 WebSocket(/ws/monitor).
 * 둘 다 nginx 단일 진입점을 경유한다 (same-origin).
 * 통신 상태·마지막 수신 시각을 함께 유지한다 (FR-37, 페일세이프 ③).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, refreshToken } from "@/lib/api";

export interface SensorValue {
  sensor_id: string;
  /** 장비 등록의 표시 이름 (미등록이면 없음) */
  name?: string | null;
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
  pos_frame?: string | null;
  /** 엣지 확장 필드 — 배치도에서 로봇 방향 표시에 쓴다 (통신 규격 §4.2) */
  heading_rad?: number | null;
  speed: number | null;
  battery_pct: number | null;
  charging: boolean;
  /** 임무가 어디까지 갔나 — 상태 (통신 규격 §4.2) */
  phase: string;
  /** 무엇이 틀어졌나 — 사건. phase 를 덮지 않고 나란히 온다 */
  error: RobotError | null;
}

export interface RobotError {
  code: string;
  message?: string | null;
  severity?: "warning" | "caution";
  since?: string | null;
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
  region_code?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  devices_total: number;
  devices_online: number;
}

export interface StopInfo {
  scope: string | null;
  engaged_at: string;
  by?: string | null;
  reason?: string | null;
  farm_ids?: string[];   // 물리 비상정지 — 걸린 농장 전체 (농장별로 독립 성립)
  /** 물리 비상정지 원 보고 (§4.7). `unknown` 도 정지로 판정되지만 문구는
   *  "작동됨"이 아니라 "확인 필요"다. */
  detail?: EstopDetail | null;
}

export interface EstopDetail {
  estop: "engaged" | "released" | "unknown";
  reason?: string | null;   // unknown 일 때: not_read_yet | read_failed | no_source
  source?: string | null;
}

export interface StopState {
  remote: StopInfo | null;
  physical_estop: StopInfo | null;
}

/**
 * 이 농장의 제어를 막아야 하는가 — 제어 UI 잠금 판정.
 *
 * 물리 비상정지는 **표시 목적상 전 농장을 모아 온다** (FR-36). 그래서 값이 있다는
 * 이유만으로 잠그면, 다른 현장에서 눌린 것으로 이 농장 제어까지 잠긴다. 걸린 농장
 * 목록에 이 농장이 있는지를 따져야 한다.
 * 원격 정지는 서버가 이미 스코프로 좁혀 주므로 존재 여부만 본다.
 */
export function controlBlocked(stops: StopState, farmId: string): boolean {
  const estop = stops.physical_estop;
  // farm_ids 가 없으면 어느 현장인지 알 수 없다 — 안전 쪽으로 잠근다 (계약상 항상 온다)
  const estopHere = estop != null && (estop.farm_ids?.includes(farmId) ?? true);
  return stops.remote != null || estopHere;
}

/**
 * 장치별 통신 상태 (FR-37) — 온라인 / 응답 지연 / 오프라인 3단계.
 *
 * 판정 근거가 장치 유형마다 다르다.
 * - 엣지·로봇·생육기: 서버가 LWT·birth/death 로 판정한 `device_connection_state`
 * - 센서: 자기 연결 레코드가 없다 (생육기가 묶어 발행한다). 마지막 수신 시각으로 본다
 * - 탱크: 수위계 센서(`{탱크}-lv`)가 값의 출처이므로 그 센서의 수신 시각을 따른다
 * - 그 외(워크스테이션): FR-37 대상이 아니다 — 발행 경로 자체가 없다
 *
 * 센서 임계값이 서버의 3배·10배 규칙과 다른 이유: 센서별 발행 주기가 스냅샷에 없다
 * (생육기가 묶어 보내고 센서마다 간격이 3~30초). 정상 동작에서 걸리지 않고 멈춘
 * 센서는 몇 분 안에 잡히는 값으로 둔다. 부모가 끊기면 그쪽 판정이 우선한다.
 */
const SENSOR_DEGRADED_SEC = 120;
const SENSOR_OFFLINE_SEC = 600;

export type LiveState = "online" | "degraded" | "offline" | "unmonitored";

/**
 * 센서 값의 신선도 — 마지막 수신 시각만으로 보는 판정.
 * 장치 목록(deviceLiveness)과 농장 상태(farmStatus)가 같은 임계를 쓰도록 여기 둔다.
 */
export function sensorLiveness(ts: string | null): "online" | "degraded" | "offline" {
  if (!ts) return "offline";
  const age = (Date.now() - new Date(ts).getTime()) / 1000;
  if (age > SENSOR_OFFLINE_SEC) return "offline";
  if (age > SENSOR_DEGRADED_SEC) return "degraded";
  return "online";
}

export function deviceLiveness(
  deviceId: string,
  deviceType: string,
  conns: Record<string, ConnState>,
  sensors: Record<string, SensorValue>,
  /** 이 장치를 묶어 발행하는 생육기 (장비 등록의 parent_device_id) */
  parentId?: string | null,
): { state: LiveState; ts: string | null } {
  const own = conns[deviceId];
  if (own) return { state: own.state, ts: own.last_received_at };

  // 탱크는 수위계 센서가 값의 출처 — 탱크 자체는 발행하지 않는다
  const sensor = sensors[deviceType === "tank" ? `${deviceId}-lv` : deviceId];
  if (!sensor) return { state: "unmonitored", ts: null };

  // 등록값(parent_device_id)이 있으면 그것을, 없으면(탱크 등) 접두사로 찾는다
  const parent = parentId
    ? conns[parentId]
    : Object.values(conns).find((c) => c.device_id.startsWith("growbed"));
  if (parent && parent.state !== "online") return { state: parent.state, ts: sensor.ts };

  return { state: sensorLiveness(sensor.ts), ts: sensor.ts };
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

/**
 * 알림 목록 응답 — 기준선 고정 페이지네이션 (서버: middleware/app/alerts.py).
 *
 * anchor 는 "목록을 연 시점의 최신 항목"이고, 서버는 그 이하만 센다. 페이지를
 * 넘기는 동안 새 알림이 도착해도 집합이 변하지 않게 하는 장치로, 화면은 받은
 * anchor 를 다음 요청에 되돌려 보낸다 (내용은 해석하지 않는다).
 *
 * 여기서 이 타입을 선언하는 이유는 계층 순서다 — lib/alerts.ts 가 이 파일을
 * 참조하고, 그 반대는 순환이 된다.
 */
export interface AlertPageResponse {
  items: AlertItem[];
  page: number;
  pages: number;
  total: number;
  unacked_total: number;
  anchor: string | null;
}

/**
 * 전역 알림 — 현재 페이지의 농장 스코프와 무관하게 전체 알림을 유지한다.
 * 소유자는 FarmDataProvider 하나뿐이다 (globalAlerts) — 소비 측에서 직접 부르면
 * 15 초마다 같은 요청이 겹친다.
 */
export function useGlobalAlerts(intervalMs = 15_000) {
  const [alerts, setAlerts] = useState<Record<number, AlertItem>>({});

  useEffect(() => {
    let active = true;

    const load = async () => {
      const res = await apiFetch("/api/alerts?limit=100");
      if (!res.ok || !active) return;
      const page: AlertPageResponse = await res.json();
      setAlerts(Object.fromEntries(page.items.map((alert) => [alert.id, alert])));
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
  const [wsOpen, setWsOpen] = useState(false);
  // 소켓이 붙어 있어도 미들웨어·브리지가 멈추면 데이터만 조용히 끊긴다.
  // 서버 맥박(_system/health)의 나이로 그 상태를 본다.
  const [serverBeat, setServerBeat] = useState<{ at: number; up: boolean } | null>(null);

  // 통신·정지 변화가 실시간으로 오면 값이 증가한다. 전 농장 스냅샷(15초 폴링)을 쓰는
  // 화면들이 이 값을 보고 즉시 다시 읽는다 — 안 그러면 상세 화면의 하드웨어 목록은
  // 바로 바뀌는데 농장 점·헤더만 최대 15초 늦게 따라온다.
  const [liveTick, setLiveTick] = useState(0);
  // 직전에 받은 통신 상태 — 전 농장분을 스코프와 무관하게 기억한다.
  // conns 를 쓰면 안 된다: 전체 스코프에서는 농장별 스냅샷을 받지 않아 늘 비어 있고,
  // 그러면 「이전 값 없음 = 바뀜」이 되어 하트비트마다 틱이 올라간다.
  const lastConnState = useRef<Record<string, string>>({});

  // 이름은 이미 받아 둔 농장 목록에서 즉시 꺼낸다. 스냅샷 응답을 기다리면 농장을
  // 옮긴 뒤에도 왕복이 끝날 때까지 **이전 농장 이름**이 제목에 남는다.
  const farmName = farms.find((f) => f.farm_id === scope)?.name ?? "";

  // 이 스코프의 스냅샷이 도착했는가 — 「아직 안 받음」과 「데이터 없음」을 구분한다
  const [snapshotReady, setSnapshotReady] = useState(false);


  // ── 초기 로드 (REST) ──
  const refreshFarms = useCallback(async () => {
    const r = await apiFetch("/api/farms");
    if (r.ok) setFarms(await r.json());
  }, []);

  const loadSnapshot = useCallback(async (farmId: string) => {
    const res = await apiFetch(`/api/farms/${farmId}/snapshot`);
    if (!res.ok) return;
    const snap = await res.json();
    setSnapshotReady(true);
    setSensors(Object.fromEntries(snap.sensors.map((s: SensorValue) => [s.sensor_id, s])));
    setRobots(Object.fromEntries(snap.robots.map((r: RobotValue) => [r.device_id, r])));
    setConns(Object.fromEntries(snap.connections.map((c: ConnState) => [c.device_id, c])));
  }, []);

  // 정지는 전 스코프 표시 대상 — WS 이벤트는 발동 순간에만 오므로 초기 로드가 필요하다.
  // 물리 비상정지는 농장별로 독립 성립해 서버가 목록으로 집계하므로, 변화 시에도
  // 이 조회를 다시 쓴다 (WS 값으로 덮어쓰면 다른 농장 것이 사라진다)
  const loadStops = useCallback(async () => {
    const url = scope === "all" ? "/api/stop-state" : `/api/farms/${scope}/stop-state`;
    const r = await apiFetch(url);
    if (r.ok) setStops(await r.json());
  }, [scope]);

  useEffect(() => {
    void refreshFarms();
    void loadStops();
    if (scope === "all") {
      // 전체 스코프 — 전 농장 알림 (fleet KPI·전역 벨·/alerts)
      apiFetch("/api/alerts?limit=100").then(async (r) => {
        if (!r.ok) return;
        const page: AlertPageResponse = await r.json();
        setAlerts(Object.fromEntries(page.items.map((a) => [a.id, a])));
      });
    }
    setSnapshotReady(false);   // 스코프가 바뀌면 이전 농장 값은 이 농장 것이 아니다
    if (scope !== "all") {
      void loadSnapshot(scope);
      apiFetch(`/api/farms/${scope}/commands`).then(async (r) => {
        if (!r.ok) return;
        const list: CommandState[] = await r.json();
        setCommands(Object.fromEntries(list.map((c) => [c.command_id, c])));
      });
      apiFetch(`/api/farms/${scope}/alerts?limit=50`).then(async (r) => {
        if (!r.ok) return;
        const page: AlertPageResponse = await r.json();
        setAlerts(Object.fromEntries(page.items.map((a) => [a.id, a])));
      });
    }
  }, [scope, loadSnapshot, loadStops, refreshFarms]);

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
      if (msg.stream === "health") {
        setServerBeat({ at: Date.now(), up: d.state === "up" });
        return;
      }
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
          setLiveTick((n) => n + 1);
        // 원격/물리 정지는 독립 표시 — 동시 성립 가능 (non-functional §2.4)
        if (d.stop_kind === "physical_estop") {
          // 농장별로 독립 성립하므로 단일 값으로 덮어쓸 수 없다 — 한 농장이 해제되면
          // 다른 농장 것까지 사라진다. 서버가 집계한 목록을 다시 읽는다
          void loadStops();
        } else {
          setStops((prev) => ({
            ...prev,
            remote: d.active
              ? { scope: d.scope, engaged_at: d.engaged_at, by: d.by, reason: d.reason }
              : null,
          }));
        }
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
        // 하트비트는 상태가 그대로여도 매 주기 온다. 그때마다 틱을 올리면 전 농장
        // 스냅샷을 10초마다 다시 읽어, 줄이려던 폴링보다 되레 늘어난다.
        // 값이 바뀐 순간과, 처음 본 장치가 정상이 아닌 경우에만 올린다.
        const before = lastConnState.current[d.device_id];
        lastConnState.current[d.device_id] = d.state;
        if (d.cascade || (before === undefined ? d.state !== "online" : before !== d.state)) {
          setLiveTick((n) => n + 1);
        }
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
        const reconnected = retry > 0;   // 첫 연결은 아래 초기 로드가 담당한다
        retry = 0;
        setWsOpen(true);
        sock.send(JSON.stringify({ action: "subscribe", scope }));
        // 끊긴 동안의 이벤트는 재전송되지 않는다 — 정지는 안전 표시라 어긋난 채로
        // 남으면 안 되므로 재연결 시 현재 상태를 다시 읽는다 (이벤트가 드물어 비용 없음)
        if (reconnected) void loadStops();
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
  }, [scope, loadStops]);

  return {
    farms, refreshFarms, farmName, sensors, robots, conns, commands, alerts, stops, wsOpen,
    liveTick, snapshotReady, serverBeat,
  };
}

/** 실패 문구를 돌려준다 (성공 null) — 정지는 조용히 실패하면 안 되는 조작이다 */
function stopError(status: number, action: string): string {
  if (status === 403) return `${action} 권한이 없습니다`;
  if (status === 409) return "이미 원격 전체 정지가 발동 중입니다";
  if (status === 404) return "발동 중인 원격 전체 정지가 없습니다";
  return `${action} 실패 — 잠시 후 다시 시도해 주세요 (${status})`;
}

export async function engageStop(reason?: string): Promise<string | null> {
  const r = await apiFetch("/api/stop", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "all", reason }),
  });
  return r.ok ? null : stopError(r.status, "원격 전체 정지");
}

export async function releaseStop(): Promise<string | null> {
  const r = await apiFetch("/api/stop/release", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "all" }),
  });
  return r.ok ? null : stopError(r.status, "정지 해제");
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

/** 이동 조작 (개정 0.3-robot-jog). 반복 주기 < 데드맨 — 그래야 끊김 없이 이어진다 (§3.1). */
export const JOG_REPEAT_MS = 400;
export const JOG_DURATION_MS = 800;
export type JogDirection = "forward" | "backward" | "left" | "right" | "stop";

export async function postJog(
  farmId: string, deviceId: string, direction: JogDirection, speed = 0.5,
): Promise<boolean> {
  const res = await apiFetch(`/api/farms/${farmId}/robots/${deviceId}/jog`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ direction, speed, duration_ms: JOG_DURATION_MS }),
  });
  return res.ok;
}

/**
 * 서버까지의 데이터 길이 살아 있는가.
 *
 * 소켓이 붙어 있다고 데이터가 오는 것은 아니다 — 미들웨어나 브리지가 멈추면
 * 소켓은 그대로인 채 값만 조용히 낡는다. 서버 맥박의 나이로 그것을 가른다.
 */
export const SERVER_BEAT_SEC = 10;
export const SERVER_SILENT_SEC = SERVER_BEAT_SEC * 3;

export type LinkState = "ok" | "socket-down" | "server-down" | "silent" | "unknown";

export function useServerLink(
  wsOpen: boolean, beat: { at: number; up: boolean } | null,
): LinkState {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  // 소켓 끊김에도 맥박과 같은 유예를 준다 (SERVER_SILENT_SEC = 주기 × 3).
  // 스코프가 바뀌면 WS effect 가 소켓을 닫고 다시 열기 때문에, 유예가 없으면 화면을
  // 옮길 때마다 배너가 깜빡인다 — 재연결은 1초 안에 끝나므로 장애가 아니다.
  // 판정 배수(×3)는 장치 쪽 지연 판정과 같은 규칙이다 (ingest.py DEGRADED_FACTOR).
  const downSince = useRef<number | null>(null);
  useEffect(() => {
    downSince.current = wsOpen ? null : Date.now();
  }, [wsOpen]);

  if (!wsOpen) {
    const since = downSince.current;
    // 유예 안이면 아직 알리지 않는다 (unknown = 배너 없음)
    if (since === null || (Date.now() - since) / 1000 <= SERVER_SILENT_SEC) return "unknown";
    return "socket-down";
  }
  if (beat === null) return "unknown";      // 아직 첫 맥박 전 (retained 라 곧 온다)
  if (!beat.up) return "server-down";       // LWT — 브로커가 대신 알린 죽음
  return (Date.now() - beat.at) / 1000 > SERVER_SILENT_SEC ? "silent" : "ok";
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 10) return "방금";
  if (sec < 60) return `${Math.floor(sec)}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return `${Math.floor(sec / 3600)}시간 전`;
}
