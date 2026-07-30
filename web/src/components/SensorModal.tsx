"use client";

/**
 * 센서 상세 모달 (디자인 "센서 상세 모달") — 현재값·상태·위치·마지막 수신 +
 * 최근 24시간 추이. 영점 보정(FR-39)은 개발 예정.
 */

import { useEffect, useState } from "react";
import { PlannedChip } from "@/components/Planned";
import { CONN_STYLE, LineChart, Modal, SENSOR_META, StatusDot } from "@/components/ui";
import { HistoryPoint, fetchHistory } from "@/lib/farmDetail";
import { SensorValue, timeAgo } from "@/lib/monitor";

export function SensorModal({
  farmId, sensor, connState, onClose,
}: {
  farmId: string;
  sensor: SensorValue;
  connState?: string;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const meta = SENSOR_META[sensor.sensor_type] ?? { name: sensor.sensor_type, unit: sensor.unit, color: "#00A05A" };

  useEffect(() => {
    void fetchHistory(farmId, sensor.sensor_type, 24, 30).then(setHistory);
  }, [farmId, sensor.sensor_type]);

  return (
    <Modal
      title={`${meta.name} · ${sensor.sensor_id}`}
      sub={sensor.location ?? undefined}
      onClose={onClose}
      wide
      footer={
        <div className="flex items-center gap-3">
          <button
            disabled title="영점 보정은 개발 예정입니다 (FR-39)"
            className="flex-1 rounded-xl bg-gray-100 py-3 text-[14px] font-extrabold text-gray-400"
          >
            영점 보정
          </button>
          <PlannedChip basis="FR-39 보정" />
          <button onClick={onClose} className="rounded-xl bg-primary px-5 py-3 text-[14px] font-extrabold text-white">
            닫기
          </button>
        </div>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-[12px] font-bold text-gray-500">현재값</div>
          <div className="text-[24px] font-extrabold">
            {sensor.value != null ? sensor.value.toFixed(1) : "—"}
            <span className="ml-0.5 text-[12px] font-bold text-muted">{meta.unit}</span>
          </div>
        </div>
        <div>
          <div className="text-[12px] font-bold text-gray-500">통신 상태</div>
          <div className="mt-1.5">
            {connState ? (
              <StatusDot sev={CONN_STYLE[connState]?.sev ?? "info"} label={CONN_STYLE[connState]?.label} />
            ) : (
              <span className="text-[13px] font-semibold text-muted">—</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[12px] font-bold text-gray-500">센서 자체 상태</div>
          <div className="mt-1 text-[13.5px] font-bold">
            {sensor.sensor_state === "ok" ? "정상" : sensor.sensor_state === "degraded" ? "이상 징후" : "고장"}
          </div>
        </div>
        <div>
          <div className="text-[12px] font-bold text-gray-500">마지막 수신</div>
          <div className="mt-1 text-[13.5px] font-bold">{timeAgo(sensor.ts)}</div>
        </div>
      </div>

      <div className="rounded-2xl bg-surface p-4">
        <div className="mb-2 text-[13px] font-extrabold">최근 24시간 추이 (30분 평균)</div>
        {history === null ? (
          <div className="flex h-[180px] items-center justify-center text-[13px] font-semibold text-muted">
            불러오는 중…
          </div>
        ) : (
          <LineChart
            height={180}
            series={[{
              name: meta.name, unit: meta.unit, color: meta.color,
              points: history.map((h) => ({ ts: h.ts, value: h.avg })),
            }]}
          />
        )}
      </div>
    </Modal>
  );
}
