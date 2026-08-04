"use client";

/**
 * 가 큰글씨 3단계 (비기능 §5) — rem 스케일 구현.
 * 디자인 전달본의 zoom 방식은 sticky/fixed 와 충돌 → html font-size 로 대체
 * (design-change-spec §6 포팅 지침). 설정은 localStorage 영속.
 *
 * 글자가 함께 커지려면 폰트 값이 rem 이어야 한다 — tailwind.config.ts 의 fontSize
 * 토큰이 그 역할을 한다. 화면에서 text-[Npx] 를 쓰면 이 배율을 받지 못한다.
 */

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

// 기준 크기(16px)는 globals.css 의 `font-size: calc(16px * var(--sf-scale))` 가 갖고,
// 여기서는 배율만 넘긴다 — 기준값을 두 곳에 두면 한쪽만 고쳐져 어긋난다.
// % 로 걸면 브라우저 기본 글자 크기 기준이 되어 「본문 13px 이상」 하한이 깨진다.
const SCALES = [1, 1.12, 1.28];  // 표준 / 크게 / 아주 크게
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
  const restored = useRef(false);

  useApplyEffect(() => {
    // 복원을 적용보다 먼저 해야 한다. 별도 useEffect 로 두면 layout effect 인 이 훅이
    // 먼저 돌아 level 0 을 localStorage 에 덮어써, 재로그인 시 설정이 초기화된다.
    if (!restored.current) {
      restored.current = true;
      const saved = Number(localStorage.getItem(KEY) ?? "0");
      // 정수만 받는다 — 소수가 들어오면 SCALES[n] 이 undefined 가 되어 calc 가 깨진다
      if (Number.isInteger(saved) && saved > 0 && saved < SCALES.length) {
        setLevel(saved);   // 같은 커밋 단계에서 재실행된다 (페인트 전)
        return;
      }
    }
    document.documentElement.style.setProperty("--sf-scale", String(SCALES[level]));
    localStorage.setItem(KEY, String(level));
  }, [level]);

  return (
    <Ctx.Provider value={{
      level,
      inc: () => setLevel((l) => Math.min(SCALES.length - 1, l + 1)),
      dec: () => setLevel((l) => Math.max(0, l - 1)),
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useFontLevel = () => useContext(Ctx);
