import { redirect } from "next/navigation";

export default async function FarmIndex({
  params,
}: {
  params: Promise<{ farmId: string }>;
}) {
  const { farmId } = await params;
  redirect(`/farms/${farmId}/status`);
}
