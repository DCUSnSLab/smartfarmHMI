"use client";

/**
 * 가 큰글씨 3단계 (비기능 §5) — rem 스케일 구현.
 * 디자인 전달본의 zoom 방식은 sticky/fixed 와 충돌 → html font-size 로 대체
 * (design-change-spec §6 포팅 지침). 설정은 localStorage 영속.
 *
 * 글자가 함께 커지려면 폰트 값이 rem 이어야 한다 — tailwind.config.ts 의 fontSize
 * 토큰이 그 역할을 한다. 화면에서 text-[Npx] 를 쓰면 이 배율을 받지 못한다.
 */

import { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";

const LEVELS = [100, 112, 128]; // % — 표준 / 크게 / 아주 크게
export const LEVEL_LABEL = ["표준", "크게", "아주 크게"];
const KEY = "sf_font_level";

// 폰트 적용은 페인트 전에 끝내야 한다 — useEffect 로 하면 이전 크기가 한 프레임
// 보여 깜빡인다. SSR 에서는 layout effect 경고를 피해 useEffect 로 떨어뜨린다.
const useApplyEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const Ctx = createContext<{ level: number; inc: () => void; dec: () => void }>({
  level: 0, inc: () => {}, dec: () => {},
});

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const saved = Number(localStorage.getItem(KEY) ?? "0");
    if (saved >= 0 && saved < LEVELS.length) setLevel(saved);
  }, []);

  useApplyEffect(() => {
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
