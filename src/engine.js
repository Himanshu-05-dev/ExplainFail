import { DETECTORS } from './detectors/index.js';

/**
 * Validates the strict evidence rule:
 * A Diagnosis or Finding must have non-empty evidence.
 * If empty: throws in test mode (NODE_ENV=test), drops otherwise.
 * @param {import('./types').Evidence[]} evidence
 * @param {string} detectorId
 * @returns {boolean} true if valid, false if dropped
 */
export function validateEvidence(evidence, detectorId) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    if (process.env.NODE_ENV === 'test') {
      throw new Error(`Evidence rule violated: Diagnosis for "${detectorId}" has empty evidence`);
    }
    return false;
  }
  return true;
}

/**
 * Runs detectors and produces confirmed diagnoses.
 * @param {import('./context').Context} ctx
 * @param {Array<import('./types').Detector>} [detectors=DETECTORS]
 * @returns {Promise<Array<import('./types').Diagnosis>>}
 */
export async function diagnose(ctx, detectors = DETECTORS) {
  const diagnoses = [];

  for (const detector of detectors) {
    try {
      // 1. Pure regex match on output
      const match = detector.match ? detector.match(ctx) : null;
      if (match) {
        // 2. Gather read-only machine evidence
        const evidence = detector.gather ? await detector.gather(ctx, match) : null;
        if (evidence && evidence.length > 0) {
          const explanation = detector.explain ? detector.explain(match, evidence) : '';
          const fixes = detector.fixes ? detector.fixes(ctx, match, evidence) : [];

          diagnoses.push({
            detectorId: detector.id,
            title: detector.title,
            kind: 'cause',
            evidence,
            explanation,
            fixes: fixes || []
          });
        }
      }

      // 3. Preflight check for findings (if present)
      if (detector.preflight) {
        const findings = await detector.preflight(ctx);
        if (Array.isArray(findings)) {
          for (const finding of findings) {
            if (finding.evidence && finding.evidence.length > 0) {
              diagnoses.push({
                detectorId: finding.detectorId || detector.id,
                title: finding.title || detector.title,
                kind: 'finding',
                evidence: finding.evidence,
                explanation: finding.explanation || finding.title,
                fixes: finding.fixes || []
              });
            }
          }
        }
      }
    } catch (err) {
      // If the error was an explicit evidence rule violation in test mode, re-throw it
      if (err.message && err.message.startsWith('Evidence rule violated')) {
        throw err;
      }
      // Otherwise, ignore detector failure and continue with other detectors
    }
  }

  return diagnoses;
}

export default {
  diagnose,
  validateEvidence
};
