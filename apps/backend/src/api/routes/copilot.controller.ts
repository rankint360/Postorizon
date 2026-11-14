import {
  Logger,
  Controller,
  Get,
  Post,
  Req,
  Res,
  Query,
  Param,
} from '@nestjs/common';
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from '@copilotkit/runtime';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { MastraAgent } from '@ag-ui/mastra';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { AiKeysService } from '@gitroom/nestjs-libraries/database/prisma/ai/ai.keys.service';
import { BrandVoiceService } from '@gitroom/nestjs-libraries/database/prisma/ai/brand.voice.service';
import { Request, Response } from 'express';
import { RequestContext } from '@mastra/core/di';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';

export type ChannelsContext = {
  integrations: string;
  organization: string;
  ui: string;
  // Postorizon Phase 4: rendered brand-voice fragment for the customer
  // group named by the request's forwarded props, when one was given
  // and resolved. Absent = behaviour identical to before.
  brandVoice?: string;
};

// the copilot runtime writes its own CORS headers on the response, keep them aligned with main.ts
const copilotCors = () => ({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:6274',
    ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
  ],
  credentials: !process.env.NOT_SECURED,
});

@Controller('/copilot')
export class CopilotController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _mastraService: MastraService,
    private _aiKeysService: AiKeysService,
    private _brandVoiceService: BrandVoiceService
  ) {}
  @Post('/chat')
  async chatAgent(@Req() req: Request, @Res() res: Response) {
    // Postorizon Phase 2 (BYOK): same key resolution as the agent endpoint.
    const byokClient = await this._aiKeysService
      .openAiClientForOrg((req as any)?.org?.id)
      .catch(() => null);
    if (
      !byokClient && (
      process.env.OPENAI_API_KEY === undefined ||
      process.env.OPENAI_API_KEY === ''
      )
    ) {
      Logger.warn('OpenAI API key not set, chat functionality will not work');
      return;
    }

    const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
      endpoint: '/copilot/chat',
      cors: copilotCors(),
      runtime: new CopilotRuntime(),
      serviceAdapter: byokClient
        ? new OpenAIAdapter({
            openai: byokClient.client,
            model: byokClient.model,
          })
        : new OpenAIAdapter({
            model: 'gpt-4.1',
          }),
    });

    return copilotRuntimeHandler(req, res);
  }

  @Post('/agent')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async agent(
    @Req() req: Request,
    @Res() res: Response,
    @GetOrgFromRequest() organization: Organization
  ) {
    // Postorizon Phase 2 (BYOK): prefer the organization's own AI key
    // for the agent runtime; fall back to the platform key when the org
    // has not stored one (AiKeysService.openAiClientForOrg).
    const byokClient = await this._aiKeysService
      .openAiClientForOrg(organization.id)
      .catch(() => null);
    if (
      !byokClient && (
      process.env.OPENAI_API_KEY === undefined ||
      process.env.OPENAI_API_KEY === ''
      )
    ) {
      Logger.warn('OpenAI API key not set, chat functionality will not work');
      return;
    }
    const mastra = await this._mastraService.mastra();
    const requestContext = new RequestContext<ChannelsContext>();
    requestContext.set(
      'integrations',
      req?.body?.body?.forwardedProps?.integrations || []
    );

    // Postorizon Phase 4 — brand voice through the agent seam (the
    // documented unblock for the Phase 2 remain; /copilot/chat has no
    // such seam and stays untouched). When the client's forwarded props
    // name a customer group, resolve its brand-voice profile and hand
    // the rendered fragment to the agent through the request context,
    // where the agent's instructions pick it up. The org is always the
    // authenticated request's org: getProfile validates that the
    // customer belongs to it and throws otherwise, and any failure
    // (foreign or unknown customer, no profile) simply leaves the
    // context unset — the request then behaves exactly as before.
    const customerId = req?.body?.body?.forwardedProps?.customerId;
    if (typeof customerId === 'string' && customerId) {
      const profile = await this._brandVoiceService
        .getProfile(organization.id, customerId)
        .catch(() => null);
      const fragment = profile
        ? this._brandVoiceService.voicePromptFragment(profile)
        : '';
      if (fragment) {
        requestContext.set('brandVoice', fragment);
      }
    }

    requestContext.set('organization', JSON.stringify(organization));
    requestContext.set('ui', 'true');

    const agents = MastraAgent.getLocalAgents({
      resourceId: organization.id,
      mastra,
      requestContext: requestContext as any,
    });

    const runtime = new CopilotRuntime({
      agents,
    });

    const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
      endpoint: '/copilot/agent',
      cors: copilotCors(),
      runtime,
      serviceAdapter: byokClient
        ? new OpenAIAdapter({
            openai: byokClient.client,
            model: byokClient.model,
          })
        : new OpenAIAdapter({
            model: 'gpt-4.1',
          }),
    });

    return copilotRuntimeHandler(req, res);
  }

  @Get('/credits')
  calculateCredits(
    @GetOrgFromRequest() organization: Organization,
    @Query('type')
    type: 'ai_images' | 'ai_videos' | 'clipping_minutes'
  ) {
    return this._subscriptionService.checkCredits(
      organization,
      type || 'ai_images'
    );
  }

  @Get('/:thread/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getMessagesList(
    @GetOrgFromRequest() organization: Organization,
    @Param('thread') threadId: string
  ): Promise<any> {
    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postiz').getMemory();
    try {
      return await memory.recall({
        resourceId: organization.id,
        threadId,
      });
    } catch (err) {
      Logger.warn(`Could not recall messages for thread ${threadId}: ${err}`);
      return { messages: [] };
    }
  }

  @Get('/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getList(@GetOrgFromRequest() organization: Organization) {
    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postiz').getMemory();
    const list = await memory.listThreads({
      filter: { resourceId: organization.id },
      perPage: 100000,
      page: 0,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    });

    return {
      threads: list.threads.map((p) => ({
        id: p.id,
        title: p.title,
      })),
    };
  }
}
