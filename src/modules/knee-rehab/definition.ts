export const kneeRehabModule = {
  key: "knee-rehab",
  displayName: "膝关节康复",
  requiredDailyFeedback: ["symptom_check_in"],
  safetySignals: ["pain", "swelling", "function", "twenty_four_hour_response"],
  garminIsSupplementalEvidence: true,
  completionRequiresUserConfirmation: true,
} as const;

// This public module definition intentionally contains no personal diagnosis,
// medical note, exercise prescription, or historical health data.
