import type { Metadata } from "next";
import { AppShell } from "@/components/shell/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "팜온 스마트팜 HMI",
  description: "웹앱 기반 스마트팜 HMI — RISE 피지컬 AI 2차년도",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="bg-surface text-body antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
