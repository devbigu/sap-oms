import { getLocalAuthSession } from "@/lib/auth/client";

export type DashboardActorRole = "admin" | "staff" | "dealer" | "accountant";

export type DashboardActor = {
  role: DashboardActorRole;
  actorId: string;
  actorName: string;
  roletype: string;
};

export function readDashboardActor(): DashboardActor | null {
  const session = getLocalAuthSession();
  if (!session) return null;

  return {
    role: session.role,
    actorId: String(session.userId).trim(),
    actorName: String(
      session.dealerName ??
        session.staffName ??
        session.name ??
        (session.role === "accountant" ? "Accountant" : "Authenticated user"),
    ).trim(),
    roletype: String(session.roletype ?? "").trim(),
  };
}
