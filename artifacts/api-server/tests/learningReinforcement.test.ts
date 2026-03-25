import { afterEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const selectLimitMock = vi.fn();
  const selectOrderByMock = vi.fn(() => ({ limit: selectLimitMock }));
  const selectFromMock = vi.fn(() => ({ orderBy: selectOrderByMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const updateWhereMock = vi.fn();
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const insertValuesMock = vi.fn();
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const repairCorruptKnowledgeRowMock = vi.fn();

  return {
    dbMock: {
      select: selectMock,
      update: updateMock,
      insert: insertMock,
    },
    selectMock,
    selectFromMock,
    selectOrderByMock,
    selectLimitMock,
    updateMock,
    updateSetMock,
    updateWhereMock,
    insertMock,
    insertValuesMock,
    repairCorruptKnowledgeRowMock,
  };
});

vi.mock("@workspace/db", () => ({
  db: mockState.dbMock,
  repairCorruptKnowledgeRow: mockState.repairCorruptKnowledgeRowMock,
}));

import * as reinforcementTelemetryModule from "../src/lib/reinforcementTelemetry";
import {
  applyVerdictToPersonalKb,
  computeReinforcedKnowledgeUpdate,
  getReinforcementCorruptionTelemetry,
  normalizeIssuePattern,
  reinforceSharedKnowledgeFromVerdict,
  resetReinforcementCorruptionTelemetry,
} from "../src/lib/learningReinforcement";
import { resetReinforcementControls, updateReinforcementControls } from "../src/lib/reinforcementTelemetry";

function createRepairResult(rowId: number, success = true, error: string | null = null) {
  return {
    rowId,
    source: null,
    detail: null,
    quarantineTableEnsured: true,
    rowSnapshotAttempted: true,
    rowSnapshotCaptured: false,
    snapshotError: null,
    quarantineInserted: true,
    knowledgeDeleteAttempted: true,
    knowledgeDeleteCount: success ? 1 : 0,
    ftsCleanupAttempted: false,
    ftsCleanupCount: 0,
    success,
    error,
  };
}

function resetDbMocks(): void {
  mockState.selectLimitMock.mockReset().mockResolvedValue([]);
  mockState.selectOrderByMock.mockReset().mockReturnValue({ limit: mockState.selectLimitMock });
  mockState.selectFromMock.mockReset().mockReturnValue({ orderBy: mockState.selectOrderByMock });
  mockState.selectMock.mockReset().mockReturnValue({ from: mockState.selectFromMock });

  mockState.updateWhereMock.mockReset().mockResolvedValue(undefined);
  mockState.updateSetMock.mockReset().mockReturnValue({ where: mockState.updateWhereMock });
  mockState.updateMock.mockReset().mockReturnValue({ set: mockState.updateSetMock });

  mockState.insertValuesMock.mockReset().mockResolvedValue(undefined);
  mockState.insertMock.mockReset().mockReturnValue({ values: mockState.insertValuesMock });

  mockState.repairCorruptKnowledgeRowMock.mockReset().mockResolvedValue(createRepairResult(0));
}

resetDbMocks();

afterEach(() => {
  vi.restoreAllMocks();
  resetDbMocks();
  resetReinforcementControls();
  resetReinforcementCorruptionTelemetry();
});

describe("normalizeIssuePattern", () => {
  it("normalizes free-form issue labels", () => {
    expect(normalizeIssuePattern("Runtime Error / Null Access")).toBe("runtime_error_null_access");
    expect(normalizeIssuePattern("!!!")).toBe("general");
  });
});

describe("applyVerdictToPersonalKb", () => {
  it("boosts personal memory on true positives", () => {
    const result = applyVerdictToPersonalKb({
      rawPersonalKb: "[]",
      role: "qa_inspector",
      filePath: "src/routes/users.ts",
      findingText: "Missing null check before dereference in getUser handler",
      functionName: "getUser",
      fileType: "ts",
      language: "typescript",
      confidence: 0.84,
      verdict: "true_positive",
    });

    const entries = JSON.parse(result.nextPersonalKb) as Array<Record<string, unknown>>;

    expect(result.action).toBe("boosted");
    expect(result.changed).toBe(true);
    expect(entries.length).toBe(1);
    expect(typeof entries[0]?.pattern).toBe("string");
    expect(Number(entries[0]?.timesFound ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Number(entries[0]?.confirmedCount ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it("degrades personal memory on false positives when a matching pattern exists", () => {
    const boosted = applyVerdictToPersonalKb({
      rawPersonalKb: "[]",
      role: "qa_inspector",
      filePath: "src/routes/users.ts",
      findingText: "Potential race condition in cache update path",
      functionName: "updateCache",
      fileType: "ts",
      language: "typescript",
      confidence: 0.9,
      verdict: "true_positive",
    });

    const beforeEntries = JSON.parse(boosted.nextPersonalKb) as Array<Record<string, unknown>>;
    const beforeConfidence = Number(beforeEntries[0]?.confidence ?? 0);

    const degraded = applyVerdictToPersonalKb({
      rawPersonalKb: boosted.nextPersonalKb,
      role: "qa_inspector",
      filePath: "src/routes/users.ts",
      findingText: "Potential race condition in cache update path",
      functionName: "updateCache",
      fileType: "ts",
      language: "typescript",
      confidence: 0.9,
      verdict: "false_positive",
    });

    const afterEntries = JSON.parse(degraded.nextPersonalKb) as Array<Record<string, unknown>>;
    const afterConfidence = Number(afterEntries[0]?.confidence ?? 0);

    expect(degraded.action).toBe("degraded");
    expect(degraded.changed).toBe(true);
    expect(afterEntries.length).toBeGreaterThanOrEqual(1);
    expect(afterConfidence).toBeLessThan(beforeConfidence);
  });

  it("keeps personal memory unchanged when false positive has no matching pattern", () => {
    const result = applyVerdictToPersonalKb({
      rawPersonalKb: "[]",
      role: "qa_inspector",
      filePath: "src/routes/users.ts",
      findingText: "This pattern was never seen before",
      functionName: "updateCache",
      fileType: "ts",
      language: "typescript",
      confidence: 0.4,
      verdict: "false_positive",
    });

    expect(result.action).toBe("none");
    expect(result.changed).toBe(false);
    expect(result.nextPersonalKb).toBe("[]");
  });

  it("ignores low-evidence reinforcement when controls require stronger confidence", () => {
    updateReinforcementControls({ minEvidenceConfidence: 0.95 });

    const result = applyVerdictToPersonalKb({
      rawPersonalKb: "[]",
      role: "qa_inspector",
      filePath: "src/routes/users.ts",
      findingText: "Potential race condition in cache update path",
      functionName: "updateCache",
      fileType: "ts",
      language: "typescript",
      confidence: 0.6,
      verdict: "true_positive",
    });

    expect(result.action).toBe("none");
    expect(result.changed).toBe(false);
    expect(result.nextPersonalKb).toBe("[]");
  });

  it("converges confidence down when conflicting verdicts repeat", () => {
    const boosted = applyVerdictToPersonalKb({
      rawPersonalKb: "[]",
      role: "qa_inspector",
      filePath: "src/routes/orders.ts",
      findingText: "Possible stale cache read after write",
      functionName: "saveOrder",
      fileType: "ts",
      language: "typescript",
      confidence: 0.88,
      verdict: "true_positive",
    });

    const firstDecay = applyVerdictToPersonalKb({
      rawPersonalKb: boosted.nextPersonalKb,
      role: "qa_inspector",
      filePath: "src/routes/orders.ts",
      findingText: "Possible stale cache read after write",
      functionName: "saveOrder",
      fileType: "ts",
      language: "typescript",
      confidence: 0.88,
      verdict: "false_positive",
    });

    const secondDecay = applyVerdictToPersonalKb({
      rawPersonalKb: firstDecay.nextPersonalKb,
      role: "qa_inspector",
      filePath: "src/routes/orders.ts",
      findingText: "Possible stale cache read after write",
      functionName: "saveOrder",
      fileType: "ts",
      language: "typescript",
      confidence: 0.88,
      verdict: "false_positive",
    });

    const boostedEntries = JSON.parse(boosted.nextPersonalKb) as Array<Record<string, unknown>>;
    const decayedEntries = JSON.parse(secondDecay.nextPersonalKb) as Array<Record<string, unknown>>;

    expect(decayedEntries.length).toBeGreaterThanOrEqual(0);
    if (decayedEntries.length > 0) {
      expect(Number(decayedEntries[0]?.confidence ?? 1)).toBeLessThan(Number(boostedEntries[0]?.confidence ?? 0));
    }
  });
});

describe("computeReinforcedKnowledgeUpdate", () => {
  it("applies positive reinforcement deltas", () => {
    const next = computeReinforcedKnowledgeUpdate({
      verdict: "true_positive",
      qualityScore: 0.6,
      wasUseful: 2,
      producedBugs: 1,
      useCount: 5,
    });

    expect(next.qualityScore).toBeCloseTo(0.68, 4);
    expect(next.wasUseful).toBe(3);
    expect(next.producedBugs).toBe(2);
    expect(next.useCount).toBe(6);
  });

  it("applies negative reinforcement deltas", () => {
    const next = computeReinforcedKnowledgeUpdate({
      verdict: "false_positive",
      qualityScore: 0.6,
      wasUseful: 2,
      producedBugs: 1,
      useCount: 5,
    });

    expect(next.qualityScore).toBeCloseTo(0.48, 4);
    expect(next.wasUseful).toBe(1);
    expect(next.producedBugs).toBe(0);
    expect(next.useCount).toBe(6);
  });
});

describe("reinforceSharedKnowledgeFromVerdict corruption handling", () => {
  it("continues after one corrupt row update, repairs once, and suppresses retry in later runs", async () => {
    vi.spyOn(reinforcementTelemetryModule, "shouldSkipReinforcementForCooldown").mockResolvedValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const corruptRow = {
      id: 9001,
      language: "typescript",
      problemType: "null_access",
      patternTags: "orders.ts,phase2",
      question: "Missing null guard in order parser",
      answer: "Add explicit order payload null checks",
      qualityScore: 0.52,
      wasUseful: 2,
      producedBugs: 1,
      useCount: 5,
    };

    const healthyRow = {
      id: 9002,
      language: "typescript",
      problemType: "null_access",
      patternTags: "phase2,general",
      question: "Null access risk in nested object handling",
      answer: "Use narrow checks before member access",
      qualityScore: 0.61,
      wasUseful: 3,
      producedBugs: 1,
      useCount: 8,
    };

    mockState.selectLimitMock.mockResolvedValue([corruptRow, healthyRow]);
    mockState.updateWhereMock
      .mockRejectedValueOnce(new Error("SQLITE_CORRUPT: database disk image is malformed"))
      .mockResolvedValue(undefined);

    mockState.repairCorruptKnowledgeRowMock.mockResolvedValue(createRepairResult(corruptRow.id, true));

    const runParams = {
      verdict: "true_positive" as const,
      filePath: "src/orders.ts",
      findingText: "Missing null guard around order payload before property access",
      issueType: "null_access",
      language: "typescript",
      confidence: 0.93,
      source: "unit-test",
    };

    const first = await reinforceSharedKnowledgeFromVerdict(runParams);
    expect(first.updatedEntries).toBe(1);
    expect(first.applied).toBe(true);
    expect(mockState.repairCorruptKnowledgeRowMock).toHaveBeenCalledTimes(1);
    expect(mockState.repairCorruptKnowledgeRowMock).toHaveBeenCalledWith(expect.objectContaining({ rowId: corruptRow.id }));

    const telemetryAfterFirst = getReinforcementCorruptionTelemetry();
    expect(telemetryAfterFirst.knownCorruptRowCount).toBe(1);
    expect(telemetryAfterFirst.rowUpdateCorruptionSkips).toBe(1);
    expect(telemetryAfterFirst.repairAttempts).toBe(1);
    expect(telemetryAfterFirst.repairSuccesses).toBe(1);
    expect(telemetryAfterFirst.repairFailures).toBe(0);
    expect(typeof telemetryAfterFirst.lastRepairTimestamp).toBe("string");

    const second = await reinforceSharedKnowledgeFromVerdict(runParams);
    expect(second.updatedEntries).toBe(1);
    expect(second.applied).toBe(true);
    expect(mockState.repairCorruptKnowledgeRowMock).toHaveBeenCalledTimes(1);
    expect(mockState.updateWhereMock).toHaveBeenCalledTimes(3);

    const telemetryAfterSecond = getReinforcementCorruptionTelemetry();
    expect(telemetryAfterSecond.suppressedKnownCorruptRowSkips).toBe(1);
    expect(telemetryAfterSecond.repairAttempts).toBe(1);
    expect(telemetryAfterSecond.knownCorruptRowCount).toBe(1);
  });

  it("increments scan corruption telemetry and does not throw", async () => {
    vi.spyOn(reinforcementTelemetryModule, "shouldSkipReinforcementForCooldown").mockResolvedValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    mockState.selectLimitMock.mockRejectedValueOnce(new Error("SQLITE_CORRUPT: scan failure"));

    const result = await reinforceSharedKnowledgeFromVerdict({
      verdict: "false_positive",
      filePath: "src/orders.ts",
      findingText: "Potential stale reference without null checks",
      issueType: "null_access",
      language: "typescript",
      confidence: 0.9,
      source: "unit-test",
    });

    expect(result.updatedEntries).toBe(0);
    expect(result.insertedEntry).toBe(false);
    expect(result.applied).toBe(false);
    expect(mockState.updateWhereMock).not.toHaveBeenCalled();

    const telemetry = getReinforcementCorruptionTelemetry();
    expect(telemetry.scanCorruptionSkips).toBe(1);
    expect(telemetry.rowUpdateCorruptionSkips).toBe(0);
    expect(telemetry.repairAttempts).toBe(0);
  });
});
