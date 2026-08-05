import type { Config } from "tailwindcss";

// 디자인 토큰 — docs/design/README.md. 포팅 지침(design-change-spec.md §6)에 따라
// 인라인 스타일 대신 여기서 토큰으로 관리한다.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // 글자 크기 토큰 — 이름은 기준 px, 값은 rem (16px 기준).
      // rem 이어야 가 큰글씨 3단계(prefs.tsx 의 root font-size)에 함께 확대된다.
      // px 로 박으면 배율이 여백에만 걸려 글자가 그대로 남는다 (비기능 §5).
      fontSize: {
        "10.5": "0.65625rem",
        "11": "0.6875rem",
        "11.5": "0.71875rem",
        "12": "0.75rem",
        "12.5": "0.78125rem",
        "13": "0.8125rem",
        "13.5": "0.84375rem",
        "14": "0.875rem",
        "14.5": "0.90625rem",
        "15": "0.9375rem",
        "15.5": "0.96875rem",
        "16": "1rem",
        "17": "1.0625rem",
        "18": "1.125rem",
        "20": "1.25rem",
        "22": "1.375rem",
        "24": "1.5rem",
        "26": "1.625rem",
        "34": "2.125rem",
        "56": "3.5rem",
      },
      colors: {
        primary: { DEFAULT: "#00A05A", dark: "#007A44", bg: "#E7F7EF" },
        status: {
          ok: "#00C271",
          caution: "#F5A623",
          cautionDark: "#E07800",
          warning: "#F04452",
          warningDark: "#E01F35",
          info: "#3182F6",
          infoDark: "#1B64DA",
        },
        surface: "#F2F4F6",
        body: "#191F28",
        muted: "#8B95A1",
      },
    },
  },
  plugins: [],
};

export default config;
