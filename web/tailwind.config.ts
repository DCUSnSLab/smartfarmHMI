import type { Config } from "tailwindcss";

// 디자인 토큰 — docs/design/README.md. 포팅 지침(design-change-spec.md §6)에 따라
// 인라인 스타일 대신 여기서 토큰으로 관리한다.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
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
