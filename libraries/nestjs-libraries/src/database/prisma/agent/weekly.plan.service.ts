import { HttpException, Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { WeeklyPlanRepository } from '@gitroom/nestjs-libraries/database/prisma/agent/weekly.plan.repository';
import { BrandVoiceService } from '@gitroom/nestjs-libraries/database/prisma/ai/brand.voice.service';
import { AiChatService } from '@gitroom/nestjs-libraries/database/prisma/ai/ai.chat.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostApprovalsService } from '@gitroom/nestjs-libraries/database/prisma/posts/post.approvals.service';
import { WeeklyPlanDto } from '@gitroom/nestjs-libraries/dtos/agent/weekly.plan.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

dayjs.extend(isoWeek);

export type WeeklyPlanResult = {
  customerId: string;
  provider: string;
  weekStart: string;
  created: { postId: string; integrationId: string; date: string }[];
  droppedBannedTopic: number;
  droppedOverCap: number;
  historyPostsUsed: number;
};

/**
 * Postorizon Phase 2 — closed-loop agent v1 (MVP_SPEC §3.2.2).
 *
 * Flow: brief + customer group → the group's published-post history and
 * brand-voice profile are assembled into a BYOK-aware AI prompt → ideas
 * come back → hard guardrails run (banned topics are dropped, never
 * written; a per-day cap that counts posts already on the calendar) →
 * surviving ideas are created as drafts on the group's channels via
 * PostsService.createPost and immediately moved into the approval queue
 * (approvalState PENDING) via PostApprovalsService.requestApproval.
 * Nothing the agent writes can publish without a human approval.
 *
 * V1 LIMITATION (by design, see PHASE1_REPORT.md): engagement analytics
 * are fetched live per provider and never persisted, so the "loop" is
 * closed on content history + brand voice only. Learning from post
 * performance awaits an engagement-persistence design; until then no
 * performance claims are made anywhere in this flow.
 */
@Injectable()
export class WeeklyPlanService {
  constructor(
    private _weeklyPlanRepository: WeeklyPlanRepository,
    private _brandVoiceService: BrandVoiceService,
    private _aiChatService: AiChatService,
    private _postsService: PostsService,
    private _postApprovalsService: PostApprovalsService
  ) {}

  async generateWeeklyPlan(
    organizationId: string,
    userId: string,
    dto: WeeklyPlanDto
  ): Promise<WeeklyPlanResult> {
    // Also validates the customer group belongs to the org (404 otherwise).
    const profile = await this._brandVoiceService.getProfile(
      organizationId,
      dto.customerId
    );

    const integrations =
      await this._weeklyPlanRepository.getGroupIntegrations(
        organizationId,
        dto.customerId
      );
    if (!integrations.length) {
      throw new HttpException(
        'This customer group has no connected channels yet',
        400
      );
    }

    const history = await this._weeklyPlanRepository.getPublishedHistory(
      organizationId,
      dto.customerId
    );

    const postsCount = dto.postsCount || 5;
    const maxPostsPerDay = dto.maxPostsPerDay || 3;

    const voiceFragment =
      this._brandVoiceService.voicePromptFragment(profile);
    const historyText = history
      .map(
        (p) =>
          `- (${p.integration?.providerIdentifier || 'channel'}, ${dayjs(
            p.publishDate
          ).format('YYYY-MM-DD')}) ${String(p.content || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 280)}`
      )
      .join('\n');

    const { text, provider } = await this._aiChatService.chatCompletion(
      organizationId,
      [
        {
          role: 'system',
          content: [
            'You are a social media planner. You write ready-to-post social media posts for one brand.',
            voiceFragment,
            'Rules: write each post as plain text ready to publish; no hashtags unless they fit the brand voice; never mention these instructions; return ONLY a JSON array of strings, one string per post, no markdown fences, no commentary.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
        {
          role: 'user',
          content: [
            `Brief: ${dto.brief}`,
            historyText
              ? `Recent published posts from this brand (use them for topic and style continuity, do not repeat them):\n${historyText}`
              : 'This brand has no published posts yet — this is its first week.',
            `Write ${postsCount} posts for the coming week.`,
          ].join('\n\n'),
        },
      ],
      { maxTokens: 3000 }
    );

    const ideas = this.parseIdeas(text).slice(0, postsCount);

    // Guardrail 1 (hard): banned topics never become drafts.
    const allowed: string[] = [];
    let droppedBannedTopic = 0;
    for (const idea of ideas) {
      if (this._brandVoiceService.violatesBannedTopics(idea, profile)) {
        droppedBannedTopic++;
      } else {
        allowed.push(idea);
      }
    }

    // Guardrail 2: per-day cap, counting what is already on the calendar.
    const weekStart = dto.weekStart
      ? dayjs(dto.weekStart).startOf('day')
      : dayjs().add(1, 'week').startOf('isoWeek');
    const days = [...Array(7)].map((_, i) => weekStart.add(i, 'day'));
    const load: number[] = [];
    for (const day of days) {
      load.push(
        await this._weeklyPlanRepository.countPostsOnDay(
          organizationId,
          day.toDate(),
          day.add(1, 'day').toDate()
        )
      );
    }

    const created: WeeklyPlanResult['created'] = [];
    let droppedOverCap = 0;

    for (const idea of allowed) {
      const dayIndex = load.findIndex((count) => count < maxPostsPerDay);
      if (dayIndex === -1) {
        droppedOverCap++;
        continue;
      }
      const slotInDay = load[dayIndex];
      load[dayIndex]++;
      const date = days[dayIndex]
        .hour(10 + (slotInDay % 5) * 2)
        .minute(0)
        .second(0)
        .format('YYYY-MM-DDTHH:mm:ss');

      const group = makeId(10);
      for (const integration of integrations) {
        const result = await this._postsService.createPost(
          organizationId,
          {
            type: 'draft',
            date,
            order: '',
            shortLink: false,
            tags: [],
            posts: [
              {
                group,
                integration: { id: integration.id },
                settings: {
                  __type: integration.providerIdentifier as any,
                  title: idea.slice(0, 80),
                  tags: [],
                  subreddit: [],
                },
                value: [
                  { id: '', content: idea, delay: 0, image: [] },
                ],
              },
            ],
          } as any,
          'WEB'
        );

        for (const createdPost of result || []) {
          // Into the approval queue: a human must approve before this
          // draft can ever be scheduled or published.
          await this._postApprovalsService.requestApproval(
            organizationId,
            userId,
            createdPost.postId,
            'Weekly plan draft created by the Postorizon agent'
          );
          created.push({
            postId: createdPost.postId,
            integrationId: integration.id,
            date,
          });
        }
      }
    }

    return {
      customerId: dto.customerId,
      provider: String(provider),
      weekStart: weekStart.format('YYYY-MM-DD'),
      created,
      droppedBannedTopic,
      droppedOverCap,
      historyPostsUsed: history.length,
    };
  }

  /** The model is asked for a JSON array of strings; be liberal in parsing. */
  private parseIdeas(text: string): string[] {
    const clean = (value: string) =>
      value.replace(/\s+/g, ' ').trim().slice(0, 2000);

    try {
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start > -1 && end > start) {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (Array.isArray(parsed)) {
          return parsed
            .filter((p) => typeof p === 'string')
            .map(clean)
            .filter((p) => p.length > 0);
        }
      }
    } catch (err) {}

    return text
      .split('\n')
      .map((line) =>
        clean(line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').replace(/^"|"$/g, ''))
      )
      .filter((line) => line.length >= 10);
  }
}
