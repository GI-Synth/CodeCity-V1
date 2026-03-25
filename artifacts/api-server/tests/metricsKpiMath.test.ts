import { describe, expect, it } from "vitest";
import { calculatePhaseOneKpis } from "../src/routes/metrics";

describe("calculatePhaseOneKpis", () => {
  it("computes Phase 1 KPIs from aggregate telemetry", () => {
    const kpis = calculatePhaseOneKpis({
      truePositives: 9,
      falsePositives: 5,
      averageAccuracy: 0.6,
      bugFoundEvents: 6,
      discardedFindingEvents: 3,
      lowConfidenceEvents: 2,
      recommendationApproved: 3,
      recommendationTotal: 4,
      testProposed: 4,
      testApproved: 3,
      resolvedFindings: 4,
      brierTotal: 0.7,
    });

    expect(kpis.predictionAccuracyScore).toBeCloseTo(0.6429, 4);
    expect(kpis.falseNegativeRate).toBeCloseTo(0.4, 4);
    expect(kpis.confidenceCalibrationIndex).toBeCloseTo(0.825, 4);
    expect(kpis.recommendationFixConversion).toBeCloseTo(0.75, 4);
    expect(kpis.testGenerationEffectiveness).toBeCloseTo(0.75, 4);
    expect(kpis.kpiSampleSize).toBe(14);
  });

  it("falls back safely when little or no telemetry exists", () => {
    const kpis = calculatePhaseOneKpis({
      truePositives: 0,
      falsePositives: 0,
      averageAccuracy: 0.82,
      bugFoundEvents: 0,
      discardedFindingEvents: 0,
      lowConfidenceEvents: 0,
      recommendationApproved: 0,
      recommendationTotal: 0,
      testProposed: 0,
      testApproved: 0,
      resolvedFindings: 0,
      brierTotal: 0,
    });

    expect(kpis.predictionAccuracyScore).toBe(0.82);
    expect(kpis.falseNegativeRate).toBe(0);
    expect(kpis.confidenceCalibrationIndex).toBe(0);
    expect(kpis.recommendationFixConversion).toBe(0);
    expect(kpis.testGenerationEffectiveness).toBe(0);
    expect(kpis.kpiSampleSize).toBe(0);
  });
});
