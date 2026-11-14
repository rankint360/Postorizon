import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { EngagementService } from '@gitroom/nestjs-libraries/database/prisma/engagement/engagement.service';
import { IntegrationHealthService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.health.service';

/**
 * Postorizon Phase 3 remediation — activities behind
 * engagementSamplingWorkflow. Both delegate straight to the shared
 * library services (resolved through the orchestrator's DatabaseModule
 * import, exactly like PostActivity resolves PostsService):
 *  - sampleAllOrganizations: one recurring engagement-sampling sweep
 *    over every organization (Item 1).
 *  - notifyTokenExpiry: the token-expiry notification sweep
 *    (Item 6) riding the same cadence.
 */
@Injectable()
@Activity()
export class EngagementActivity {
  constructor(
    private _engagementService: EngagementService,
    private _integrationHealthService: IntegrationHealthService
  ) {}

  @ActivityMethod()
  async sampleAllOrganizations() {
    return this._engagementService.sampleAllOrganizations();
  }

  @ActivityMethod()
  async notifyTokenExpiry() {
    return this._integrationHealthService.notifyTokenExpiryForAllOrganizations();
  }
}
