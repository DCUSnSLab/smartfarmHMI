"use client";

/**
 * 가 큰글씨 3단계 (비기능 §5) — rem 스케일 구현.
 * 디자인 전달본의 zoom 방식은 sticky/fixed 와 충돌 → html font-size 로 대체
 * (design-change-spec §6 포팅 지침). 설정은 localStorage 영속.
 */

import { createContext, useContext, useEffect, useState } from "react";

const LEVELS = [100, 112, 128]; // % — 표준 / 크게 / 아주 크게
export const LEVEL_LABEL = ["표준", "크게", "아주 크게"];
const KEY = "sf_font_level";

const Ctx = createContext<{ level: number; inc: () => void; dec: () => void }>({
  level: 0, inc: () => {}, dec: () => {},
});

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const saved = Number(localStorage.getItem(KEY) ?? "0");
    if (saved >= 0 && saved < LEVELS.length) setLevel(saved);
  }, []);

  useEffect(() => {
    document.documentElement.style.fontSize = `${LEVELS[level]}%`;
    localStorage.setItem(KEY, String(level));
  }, [level]);

  return (
    <Ctx.Provider value={{
      level,
      inc: () => setLevel((l) => Math.min(LEVELS.length - 1, l + 1)),
      dec: () => setLevel((l) => Math.max(0, l - 1)),
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useFontLevel = () => useContext(Ctx);
