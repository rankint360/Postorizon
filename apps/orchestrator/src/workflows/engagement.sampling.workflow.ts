import {
  continueAsNew,
  patched,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import { EngagementActivity } from '@gitroom/orchestrator/activities/engagement.activity';

const { sampleAllOrganizations, notifyTokenExpiry } =
  proxyActivities<EngagementActivity>({
    startToCloseTimeout: '30 minute',
    taskQueue: 'main',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });

/**
 * Cadence of the recurring engagement-sampling sweep (Phase 3
 * remediation, Item 1). Sampling is bounded per organization by
 * EngagementService.sampleOrganization's own caps (30-day window,
 * 50 posts), so a 6-hour cadence keeps snapshots fresh for best-time
 * and the agent feedback loop without hammering provider APIs.
 */
export const ENGAGEMENT_SAMPLING_INTERVAL_HOURS = 6;

/**
 * Infinite periodic workflow — this codebase has no Temporal Schedule
 * registrations; periodic work is an infinite sleep + continueAsNew
 * workflow started once at boot (the missingPostWorkflow pattern).
 * Started by EngagementSamplingRegister (orchestrator AppModule) under
 * the fixed workflow id 'engagement-sampling-workflow'.
 */
export async function engagementSamplingWorkflow() {
  let loops = 0;
  await sampleAllOrganizations();
  await notifyTokenExpiry();
  while (true) {
    await sleep(`${ENGAGEMENT_SAMPLING_INTERVAL_HOURS} hours`);

    // Keep the history small; the new run sweeps immediately, so the
    // cadence is kept across continue-as-new.
    if (
      patched('engagement-sampling-continue-as-new') &&
      (++loops >= 24 || workflowInfo().historyLength > 1000)
    ) {
      return await continueAsNew<typeof engagementSamplingWorkflow>();
    }

    await sampleAllOrganizations();
    await notifyTokenExpiry();
  }
}
