import { ResumptionAssessmentClient } from "@/components/resumption-assessment-client";

export default async function ResumptionAssessmentPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  return (
    <ResumptionAssessmentClient assessmentId={(await params).assessmentId} />
  );
}
