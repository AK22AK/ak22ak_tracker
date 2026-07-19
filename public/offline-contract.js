(() => {
  "use strict";

  const SCHEMA_VERSION = 2;
  const snapshotKinds = new Set(["today", "calendar-month", "day"]);
  const commandKinds = new Set(["task_update", "symptom_check_in"]);
  const commandStatuses = new Set([
    "local_only",
    "syncing",
    "retryable",
    "waiting_auth",
    "needs_attention",
  ]);
  const taskStates = new Set(["planned", "completed", "skipped"]);
  const dayStates = new Set(["missing", "not_started", "ready"]);
  const feedbackTimings = new Set([
    "morning",
    "post_training",
    "next_day",
    "incident",
  ]);
  const swellingLevels = new Set(["none", "mild", "obvious"]);
  const safetyLevels = new Set(["green", "yellow", "red"]);
  const safetyReasons = new Set([
    "red_feedback",
    "illness",
    "acute_symptom",
    "pause",
    "resumption",
  ]);
  const contextKinds = new Set(["travel", "equipment_limited"]);
  const contextStatuses = new Set(["upcoming", "active"]);
  const pauseReasons = new Set([
    "illness",
    "acute_symptom",
    "red_feedback",
    "other",
  ]);
  const venues = new Set([
    "hotel_gym",
    "room",
    "stairs",
    "outdoors",
    "transit",
    "none",
  ]);
  const equipmentKinds = new Set([
    "machines",
    "dumbbells",
    "chair",
    "stairs",
    "backpack",
    "none",
  ]);

  function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function hasOnlyKeys(value, keys) {
    return Object.keys(value).every((key) => keys.includes(key));
  }

  function isNonEmptyString(value, max = Number.POSITIVE_INFINITY) {
    return typeof value === "string" && value.length > 0 && value.length <= max;
  }

  function isNullableString(value, max = Number.POSITIVE_INFINITY) {
    return value === null || (typeof value === "string" && value.length <= max);
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isNonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
  }

  function isLocalDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }

  function isMonth(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) {
      return false;
    }
    const parsed = new Date(`${value}-01T00:00:00Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 7) === value
    );
  }

  function isInstant(value) {
    return (
      typeof value === "string" &&
      /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value))
    );
  }

  function isUuid(value) {
    return (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  }

  function isTrackerKey(value) {
    return (
      typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,119}$/.test(value)
    );
  }

  function isIanaTimeZone(value) {
    if (!isNonEmptyString(value, 100)) return false;
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }

  function validPlanReference(value) {
    if (value === null) return true;
    const plan = objectValue(value);
    return Boolean(
      plan &&
      isUuid(plan.id) &&
      isPositiveInteger(plan.version) &&
      isLocalDate(plan.effectiveFrom),
    );
  }

  function validSafetyPolicyReference(value) {
    const policy = objectValue(value);
    return Boolean(
      policy &&
      isUuid(policy.policyId) &&
      isPositiveInteger(policy.version) &&
      typeof policy.hash === "string" &&
      /^[0-9a-f]{64}$/.test(policy.hash),
    );
  }

  function validTaskActual(value) {
    if (value === null) return true;
    const actual = objectValue(value);
    if (
      !actual ||
      !["exercise_list", "endurance", "general"].includes(actual.kind) ||
      !Array.isArray(actual.exercises) ||
      actual.exercises.length > 50 ||
      !isNullableNumber(actual.durationMinutes, 0, 1_440) ||
      !isNullableNumber(actual.distanceKm, 0, 1_000) ||
      typeof actual.summary !== "string" ||
      actual.summary.length > 2_000
    ) {
      return false;
    }
    return actual.exercises.every((exerciseValue) => {
      const exercise = objectValue(exerciseValue);
      return Boolean(
        exercise &&
        isNonEmptyString(exercise.name, 200) &&
        typeof exercise.completed === "boolean" &&
        typeof exercise.actual === "string" &&
        exercise.actual.length <= 500,
      );
    });
  }

  function isNullableNumber(value, min, max) {
    return (
      value === null || (isFiniteNumber(value) && value >= min && value <= max)
    );
  }

  function validTask(value) {
    const task = objectValue(value);
    return Boolean(
      task &&
      isUuid(task.id) &&
      isNonEmptyString(task.title, 200) &&
      (!hasOwn(task, "description") ||
        (typeof task.description === "string" &&
          task.description.length <= 2_000)) &&
      isNonEmptyString(task.category, 120) &&
      objectValue(task.prescription) &&
      taskStates.has(task.status) &&
      validTaskActual(task.actual) &&
      isNullableString(task.subjectiveNote, 2_000),
    );
  }

  function validFeedback(value) {
    const feedback = objectValue(value);
    return Boolean(
      feedback &&
      isUuid(feedback.id) &&
      isInstant(feedback.occurredAt) &&
      feedbackTimings.has(feedback.timing) &&
      isFiniteNumber(feedback.leftPain) &&
      isFiniteNumber(feedback.rightPain) &&
      swellingLevels.has(feedback.swelling) &&
      safetyLevels.has(feedback.safetyLevel) &&
      (!hasOwn(feedback, "safetyPolicy") ||
        validSafetyPolicyReference(feedback.safetyPolicy)) &&
      typeof feedback.note === "string",
    );
  }

  function validDayDashboard(value) {
    const day = objectValue(value);
    if (
      !day ||
      !dayStates.has(day.state) ||
      !isNonEmptyString(day.trackerName) ||
      !(day.startDate === null || isLocalDate(day.startDate)) ||
      !(day.planVersion === null || isPositiveInteger(day.planVersion)) ||
      !Array.isArray(day.tasks) ||
      !day.tasks.every(validTask) ||
      !isNonNegativeInteger(day.feedbackCount) ||
      !Array.isArray(day.feedbacks) ||
      !day.feedbacks.every(validFeedback) ||
      day.feedbackCount !== day.feedbacks.length ||
      !Array.isArray(day.externalTrainingRecords)
    ) {
      return false;
    }
    return true;
  }

  function validTracker(value, trackerKey) {
    const tracker = objectValue(value);
    return Boolean(
      tracker &&
      tracker.key === trackerKey &&
      isTrackerKey(tracker.key) &&
      isNonEmptyString(tracker.name) &&
      isLocalDate(tracker.startedOn) &&
      isIanaTimeZone(tracker.planningTimeZone),
    );
  }

  function validExecutionContext(value) {
    if (value === null) return true;
    const context = objectValue(value);
    return Boolean(
      context &&
      isUuid(context.id) &&
      contextKinds.has(context.kind) &&
      isLocalDate(context.startDate) &&
      isLocalDate(context.endDate) &&
      contextStatuses.has(context.status),
    );
  }

  function validExecutionConditions(value) {
    const conditions = objectValue(value);
    return Boolean(
      conditions &&
      Number.isInteger(conditions.availableMinutes) &&
      conditions.availableMinutes >= 0 &&
      conditions.availableMinutes <= 240 &&
      venues.has(conditions.venue) &&
      Array.isArray(conditions.equipment) &&
      conditions.equipment.length <= 6 &&
      conditions.equipment.every((item) => equipmentKinds.has(item)) &&
      ["normal", "illness", "acute_symptom"].includes(
        conditions.healthStatus,
      ) &&
      (!hasOwn(conditions, "note") ||
        (typeof conditions.note === "string" && conditions.note.length <= 500)),
    );
  }

  function validAlternativeReference(value) {
    if (value === null) return true;
    const reference = objectValue(value);
    return Boolean(
      reference &&
      isUuid(reference.optionId) &&
      isPositiveInteger(reference.optionVersion),
    );
  }

  function validExecutionDay(value) {
    if (value === null) return true;
    const day = objectValue(value);
    return Boolean(
      day &&
      isLocalDate(day.localDate) &&
      validExecutionConditions(day.conditions) &&
      validAlternativeReference(day.selection) &&
      ["normal", "stop_reassess"].includes(day.safetyDisposition),
    );
  }

  function validExecutionAlternative(value) {
    const alternative = objectValue(value);
    const estimated = objectValue(alternative?.estimatedMinutes);
    return Boolean(
      alternative &&
      isUuid(alternative.id) &&
      isNonEmptyString(alternative.optionKey, 120) &&
      /^[a-z0-9][a-z0-9_-]*$/.test(alternative.optionKey) &&
      isPositiveInteger(alternative.version) &&
      ["alternative", "micro_training"].includes(alternative.kind) &&
      isNonEmptyString(alternative.title, 120) &&
      isNonEmptyString(alternative.summary, 1_000) &&
      estimated &&
      Number.isInteger(estimated.min) &&
      estimated.min >= 0 &&
      estimated.min <= 240 &&
      Number.isInteger(estimated.max) &&
      estimated.max >= 0 &&
      estimated.max <= 240 &&
      Array.isArray(alternative.steps) &&
      alternative.steps.length >= 1 &&
      alternative.steps.length <= 30 &&
      alternative.steps.every((step) => isNonEmptyString(step, 500)),
    );
  }

  function validPause(value) {
    if (value === undefined || value === null) return true;
    const pause = objectValue(value);
    return Boolean(
      pause &&
      isUuid(pause.id) &&
      pauseReasons.has(pause.reason) &&
      isNullableString(pause.note, 500) &&
      isLocalDate(pause.startedOn) &&
      (pause.endedOn === null || isLocalDate(pause.endedOn)) &&
      ["active", "pending_resume_assessment"].includes(pause.status),
    );
  }

  function validResumption(value) {
    if (value === undefined || value === null) return true;
    const resumption = objectValue(value);
    const basePlan = objectValue(resumption?.basePlanVersion);
    return Boolean(
      resumption &&
      isUuid(resumption.id) &&
      ["execution_context", "pause"].includes(resumption.triggerType) &&
      isLocalDate(resumption.recommendedEffectiveFrom) &&
      basePlan &&
      isUuid(basePlan.id) &&
      isPositiveInteger(basePlan.version) &&
      resumption.status === "pending",
    );
  }

  function validExecution(value) {
    const execution = objectValue(value);
    const safety = objectValue(execution?.safety);
    if (
      !execution ||
      !hasOwn(execution, "context") ||
      !validExecutionContext(execution.context) ||
      !hasOwn(execution, "day") ||
      !validExecutionDay(execution.day) ||
      !Array.isArray(execution.alternatives) ||
      !execution.alternatives.every(validExecutionAlternative) ||
      !validPause(execution.pause) ||
      !validResumption(execution.resumption) ||
      !safety ||
      typeof safety.blocked !== "boolean" ||
      !(safety.reason === null || safetyReasons.has(safety.reason))
    ) {
      return false;
    }
    return true;
  }

  function validTodayData(value, trackerKey, scope) {
    const data = objectValue(value);
    return Boolean(
      data &&
      isLocalDate(scope) &&
      data.targetDate === scope &&
      validTracker(data.tracker, trackerKey) &&
      validPlanReference(data.plan) &&
      validDayDashboard(data.day) &&
      validSafetyPolicyReference(data.safetyPolicy) &&
      validExecution(data.execution),
    );
  }

  function validCalendarDay(value, month) {
    const day = objectValue(value);
    return Boolean(
      day &&
      isLocalDate(day.date) &&
      day.date.slice(0, 7) === month &&
      isNonNegativeInteger(day.taskCount) &&
      isNonNegativeInteger(day.completedCount) &&
      isNonNegativeInteger(day.skippedCount) &&
      isNonNegativeInteger(day.feedbackCount) &&
      day.completedCount + day.skippedCount <= day.taskCount &&
      (!hasOwn(day, "paused") || typeof day.paused === "boolean"),
    );
  }

  function validCalendarData(value, trackerKey, scope) {
    const data = objectValue(value);
    if (
      !data ||
      !isMonth(scope) ||
      data.trackerKey !== trackerKey ||
      data.month !== scope ||
      !Array.isArray(data.days) ||
      !data.days.every((day) => validCalendarDay(day, scope))
    ) {
      return false;
    }
    const dates = data.days.map((day) => day.date);
    return new Set(dates).size === dates.length;
  }

  function validDayData(value, trackerKey, scope) {
    const data = objectValue(value);
    return Boolean(
      data &&
      isLocalDate(scope) &&
      data.trackerKey === trackerKey &&
      data.targetDate === scope &&
      validPlanReference(data.plan) &&
      validDayDashboard(data.day),
    );
  }

  function validSnapshotRow(value, identity, now = Date.now()) {
    const row = objectValue(value);
    if (
      !row ||
      typeof identity !== "string" ||
      !/^\d+$/.test(identity) ||
      row.githubUserId !== identity ||
      row.schemaVersion !== SCHEMA_VERSION ||
      !isTrackerKey(row.trackerKey) ||
      !snapshotKinds.has(row.kind) ||
      !isNonEmptyString(row.scope) ||
      row.id !==
        `${row.githubUserId}:${row.trackerKey}:${row.kind}:${row.scope}` ||
      !isInstant(row.savedAt) ||
      !isInstant(row.expiresAt) ||
      Date.parse(row.expiresAt) <= now ||
      !isNonEmptyString(row.sourceVersion) ||
      !objectValue(row.data)
    ) {
      return false;
    }
    if (row.kind === "today") {
      return validTodayData(row.data, row.trackerKey, row.scope);
    }
    if (row.kind === "calendar-month") {
      return validCalendarData(row.data, row.trackerKey, row.scope);
    }
    return validDayData(row.data, row.trackerKey, row.scope);
  }

  function validCheckIn(value) {
    const checkIn = objectValue(value);
    return Boolean(
      checkIn &&
      hasOnlyKeys(checkIn, [
        "timing",
        "leftPain",
        "rightPain",
        "swelling",
        "stiffness",
        "mechanicalSymptoms",
        "weightBearingIssue",
        "localizedBonePain",
        "nightOrRestPain",
        "note",
      ]) &&
      feedbackTimings.has(checkIn.timing) &&
      Number.isInteger(checkIn.leftPain) &&
      checkIn.leftPain >= 0 &&
      checkIn.leftPain <= 10 &&
      Number.isInteger(checkIn.rightPain) &&
      checkIn.rightPain >= 0 &&
      checkIn.rightPain <= 10 &&
      swellingLevels.has(checkIn.swelling) &&
      typeof checkIn.stiffness === "boolean" &&
      typeof checkIn.mechanicalSymptoms === "boolean" &&
      typeof checkIn.weightBearingIssue === "boolean" &&
      typeof checkIn.localizedBonePain === "boolean" &&
      typeof checkIn.nightOrRestPain === "boolean" &&
      typeof checkIn.note === "string" &&
      checkIn.note.length <= 2_000,
    );
  }

  function validPendingCommand(value, identity) {
    const command = objectValue(value);
    if (
      !command ||
      !hasOnlyKeys(command, [
        "id",
        "schemaVersion",
        "githubUserId",
        "trackerKey",
        "kind",
        "createdAt",
        "occurredAt",
        "localDate",
        "occurredTimeZone",
        "occurredUtcOffsetMinutes",
        "attemptCount",
        "nextAttemptAt",
        "lastAttemptAt",
        "lastErrorCode",
        "status",
        "sourceVersion",
        "payload",
      ]) ||
      command.schemaVersion !== 1 ||
      command.githubUserId !== identity ||
      !/^\d+$/.test(identity) ||
      !isUuid(command.id) ||
      !isTrackerKey(command.trackerKey) ||
      !commandKinds.has(command.kind) ||
      !isInstant(command.createdAt) ||
      !isInstant(command.occurredAt) ||
      !isLocalDate(command.localDate) ||
      !isNonEmptyString(command.occurredTimeZone, 100) ||
      !Number.isInteger(command.occurredUtcOffsetMinutes) ||
      command.occurredUtcOffsetMinutes < -840 ||
      command.occurredUtcOffsetMinutes > 840 ||
      !isNonNegativeInteger(command.attemptCount) ||
      !isInstant(command.nextAttemptAt) ||
      !(command.lastAttemptAt === null || isInstant(command.lastAttemptAt)) ||
      !isNullableString(command.lastErrorCode, 120) ||
      !commandStatuses.has(command.status) ||
      !isNullableString(command.sourceVersion, 500)
    ) {
      return false;
    }
    const payload = objectValue(command.payload);
    if (!payload) return false;
    if (command.kind === "task_update") {
      return Boolean(
        hasOnlyKeys(payload, [
          "taskId",
          "status",
          "actual",
          "note",
          "baseStatus",
          "planVersion",
        ]) &&
        isUuid(payload.taskId) &&
        taskStates.has(payload.status) &&
        validTaskActual(payload.actual) &&
        isNullableString(payload.note, 2_000) &&
        taskStates.has(payload.baseStatus) &&
        (payload.planVersion === null ||
          isPositiveInteger(payload.planVersion)),
      );
    }
    return Boolean(
      hasOnlyKeys(payload, [
        "checkIn",
        "clientSafetyPolicy",
        "localSafetyLevel",
      ]) &&
      validCheckIn(payload.checkIn) &&
      (payload.clientSafetyPolicy === null ||
        validSafetyPolicyReference(payload.clientSafetyPolicy)) &&
      (payload.localSafetyLevel === null ||
        safetyLevels.has(payload.localSafetyLevel)),
    );
  }

  function createPendingTaskCommand(value) {
    const input = objectValue(value);
    if (!input) return null;
    const command = {
      id: input.id,
      schemaVersion: 1,
      githubUserId: input.githubUserId,
      trackerKey: input.trackerKey,
      kind: "task_update",
      createdAt: input.createdAt,
      occurredAt: input.occurredAt,
      localDate: input.localDate,
      occurredTimeZone: input.occurredTimeZone,
      occurredUtcOffsetMinutes: input.occurredUtcOffsetMinutes,
      attemptCount: 0,
      nextAttemptAt: input.createdAt,
      lastAttemptAt: null,
      lastErrorCode: null,
      status: "local_only",
      sourceVersion: input.sourceVersion ?? null,
      payload: {
        taskId: input.taskId,
        status: input.status,
        actual: input.actual,
        note: input.note,
        baseStatus: input.baseStatus,
        planVersion: input.planVersion,
      },
    };
    return validPendingCommand(command, command.githubUserId) ? command : null;
  }

  globalThis.AKTrackerOfflineContract = Object.freeze({
    validSnapshotRow,
    validTodayData,
    validCalendarData,
    validDayData,
    validPendingCommand,
    createPendingTaskCommand,
  });
})();
