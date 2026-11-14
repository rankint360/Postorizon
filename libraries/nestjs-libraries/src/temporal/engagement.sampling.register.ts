import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

/**
 * Postorizon Phase 3 remediation (Item 1) — starts the recurring
 * engagement-sampling workflow once at boot.
 *
 * This codebase has NO Temporal Schedule registrations anywhere; the
 * established pattern for periodic work is an infinite sleep +
 * continueAsNew workflow started by an OnModuleInit register gated on
 * RUN_CRON (InfiniteWorkflowRegister / missingPostWorkflow). This
 * register mirrors that pattern exactly, with two hardening tweaks:
 *  - a fixed workflow id ('engagement-sampling-workflow'), and
 *  - USE_EXISTING conflict policy, so restarts and multiple booting
 *    replicas never create a second sweep.
 *
 * Deployment: import EngagementSamplingRegisterModule in the
 * ORCHESTRATOR AppModule (done) and set RUN_CRON on the orchestrator
 * service — the same env flag that gates missingPostWorkflow's
 * registration on the backend service today.
 */
@Injectable()
export class EngagementSamplingRegister implements OnModuleInit {
  constructor(private _temporalService: TemporalService) {}

  async onModuleInit(): Promise<void> {
    if (!!process.env.RUN_CRON) {
      try {
        await this._temporalService.client
          ?.getRawClient()
          ?.workflow?.start('engagementSamplingWorkflow', {
            workflowId: 'engagement-sampling-workflow',
            taskQueue: 'main',
            workflowIdConflictPolicy: 'USE_EXISTING',
          });
      } catch (err) {}
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [EngagementSamplingRegister],
  get exports() {
    return this.providers;
  },
})
export class EngagementSamplingRegisterModule {}
