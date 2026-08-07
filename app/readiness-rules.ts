import type { CertificationRecord } from "./personal-files.tsx";
import { getExpiryState, isMedicalCertificationSuperseded, latestCertificationRecords } from "./personal-files-rules.ts";
import type { PilotPersonalProfile } from "./pilot-profile-rules.ts";

export type ReadinessStatus = "allowed" | "restricted" | "not_allowed" | "undetermined";
export type ReadinessOverride = "auto" | Exclude<ReadinessStatus, "undetermined">;

export type ReadinessIssue = {
  id: string;
  label: string;
  detail: string;
  level: "warning" | "danger";
};

export type EmployeeReadiness = {
  status: ReadinessStatus;
  label: string;
  automaticStatus: ReadinessStatus;
  manual: boolean;
  reasons: ReadinessIssue[];
};

export const readinessLabels: Record<ReadinessStatus, string> = {
  allowed: "Допущен",
  restricted: "Допущен с ограничениями",
  not_allowed: "Не допущен",
  undetermined: "Статус не определён",
};

function medicalRecord(profile: PilotPersonalProfile) {
  return {
    endDate: profile.medical.expiryDate,
    startDate: profile.medical.examinationDate,
    issuedDate: profile.medical.examinationDate,
    organization: "",
    documentType: "Медицинское заключение",
    number: profile.medical.seriesNumber,
  };
}

export function employeeReadiness(
  records: CertificationRecord[],
  profile: PilotPersonalProfile,
  today = new Date(),
): EmployeeReadiness {
  const current = latestCertificationRecords(records)
    .filter((record) => !isMedicalCertificationSuperseded(record, profile.medical.expiryDate));
  const issues: ReadinessIssue[] = [];
  let hasDatedControl = false;

  current.forEach((record) => {
    if (!record.endDate) return;
    hasDatedControl = true;
    const state = getExpiryState(record, today);
    if (state.level === "expired" || state.level === "incomplete") issues.push({
      id: record.id,
      label: record.certificationType || record.documentType || record.category || "Документ",
      detail: state.label,
      level: "danger",
    });
    else if (state.level === "alert14" || state.level === "alert45") issues.push({
      id: record.id,
      label: record.certificationType || record.documentType || record.category || "Документ",
      detail: state.label,
      level: "warning",
    });
  });

  if (profile.medical.expiryDate) {
    hasDatedControl = true;
    const state = getExpiryState(medicalRecord(profile), today);
    if (state.level === "expired" || state.level === "incomplete") issues.push({ id: "medical", label: "Медицинское заключение", detail: state.label, level: "danger" });
    else if (state.level === "alert14" || state.level === "alert45") issues.push({ id: "medical", label: "Медицинское заключение", detail: state.label, level: "warning" });
  }

  const automaticStatus: ReadinessStatus = issues.some((item) => item.level === "danger")
    ? "not_allowed"
    : issues.length
      ? "restricted"
      : hasDatedControl
        ? "allowed"
        : "undetermined";
  const override = profile.readiness?.override ?? "auto";
  const manual = override !== "auto";
  const status = manual ? override : automaticStatus;
  const manualReason = profile.readiness?.reason.trim();
  const reasons = manual && manualReason
    ? [{ id: "manual", label: "Ручное ограничение", detail: [manualReason, profile.readiness?.until ? `до ${profile.readiness.until}` : ""].filter(Boolean).join(" · "), level: status === "not_allowed" ? "danger" as const : "warning" as const }, ...issues]
    : issues;
  return { status, label: readinessLabels[status], automaticStatus, manual, reasons };
}

export function readinessBlockReason(readiness?: EmployeeReadiness): string | null {
  if (!readiness || readiness.status !== "not_allowed") return null;
  const reason = readiness.reasons[0];
  return reason ? `${readiness.label}: ${reason.label} — ${reason.detail}` : readiness.label;
}
