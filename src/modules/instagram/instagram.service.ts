import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Instagram feed for the storefront.
 *
 * Instagram's Basic Display API was shut down on 4 December 2024, so the only
 * supported route is the Instagram Graph API: a Business or Creator account
 * linked to a Facebook Page, reached with a long-lived token.
 *
 * The token is deliberately read here and never returned to the browser. It
 * grants access to the account's media, so it belongs on the server; the
 * storefront asks this endpoint and gets posts back, never credentials.
 *
 * Everything fails open. A missing token, an expired one, a rate limit or an
 * Instagram outage all return an empty list, and the homepage section simply
 * does not render — a social rail is never worth breaking a page over.
 */

export interface InstagramPost {
  id: string;
  caption: string | null;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  permalink: string;
  timestamp: string | null;
}

interface CacheEntry {
  posts: InstagramPost[];
  expiresAt: number;
}

/** Instagram's rate limits are per-hour, and the feed changes slowly. */
const CACHE_TTL_MS = 30 * 60_000;
const FETCH_TIMEOUT_MS = 4000;
const GRAPH_BASE = 'https://graph.instagram.com';

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private cache: CacheEntry | null = null;
  /** Set when Instagram rejects the token, so admin can be told plainly. */
  private lastError: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async token(): Promise<string | null> {
    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key: 'instagramAccessToken' },
      });
      return row?.value?.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Recent posts, newest first.
   *
   * `limit` is capped because this feeds a homepage rail, not an archive —
   * and every extra item is another image the page has to load.
   */
  async getFeed(limit = 8): Promise<InstagramPost[]> {
    const take = Math.min(Math.max(limit, 1), 24);

    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.posts.slice(0, take);
    }

    const accessToken = await this.token();
    if (!accessToken) {
      this.lastError = 'No access token configured.';
      return [];
    }

    const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
    const url = `${GRAPH_BASE}/me/media?fields=${fields}&limit=24&access_token=${encodeURIComponent(accessToken)}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      const body = (await res.json().catch(() => null)) as {
        data?: unknown[];
        error?: { message?: string };
      } | null;

      if (!res.ok || body?.error) {
        // Surfaced to admin rather than buried: an expired token is the
        // normal failure here and someone has to be told to refresh it.
        this.lastError = body?.error?.message ?? `Instagram returned ${res.status}`;
        this.logger.warn(`Instagram feed unavailable: ${this.lastError}`);
        return this.cache?.posts.slice(0, take) ?? [];
      }

      const posts: InstagramPost[] = (Array.isArray(body?.data) ? body!.data : [])
        .map((raw) => {
          const m = raw as Record<string, string | undefined>;
          if (!m.id || !m.permalink) return null;
          // A video's media_url is the video file; thumbnail_url is the still.
          const image = m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url;
          if (!image) return null;
          return {
            id: m.id,
            caption: m.caption ?? null,
            mediaType: m.media_type ?? 'IMAGE',
            mediaUrl: image,
            thumbnailUrl: m.thumbnail_url ?? null,
            permalink: m.permalink,
            timestamp: m.timestamp ?? null,
          };
        })
        .filter((p): p is InstagramPost => p !== null);

      this.lastError = null;
      this.cache = { posts, expiresAt: Date.now() + CACHE_TTL_MS };
      return posts.slice(0, take);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Request failed';
      this.logger.warn(`Instagram feed request failed: ${this.lastError}`);
      // Stale posts beat an empty rail while Instagram is having a moment.
      return this.cache?.posts.slice(0, take) ?? [];
    }
  }

  /**
   * What admin needs to show a connection state, without ever handing the
   * token back. Long-lived tokens expire after 60 days, so "connected" alone
   * would be a half-truth — this actually calls Instagram.
   */
  async status(): Promise<{
    connected: boolean;
    username: string | null;
    postCount: number;
    error: string | null;
  }> {
    const accessToken = await this.token();
    if (!accessToken) {
      return { connected: false, username: null, postCount: 0, error: 'No access token saved.' };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(
        `${GRAPH_BASE}/me?fields=username,media_count&access_token=${encodeURIComponent(accessToken)}`,
        { signal: controller.signal },
      );
      clearTimeout(timer);
      const body = (await res.json().catch(() => null)) as {
        username?: string;
        media_count?: number;
        error?: { message?: string };
      } | null;

      if (!res.ok || body?.error) {
        return {
          connected: false,
          username: null,
          postCount: 0,
          error: body?.error?.message ?? `Instagram returned ${res.status}`,
        };
      }
      return {
        connected: true,
        username: body?.username ?? null,
        postCount: body?.media_count ?? 0,
        error: null,
      };
    } catch (err) {
      return {
        connected: false,
        username: null,
        postCount: 0,
        error: err instanceof Error ? err.message : 'Could not reach Instagram.',
      };
    }
  }

  /**
   * Long-lived tokens last 60 days and can be exchanged for a fresh 60 days
   * at any point after they are 24 hours old. Called by admin's Refresh
   * button so nobody has to go back through Meta's dashboard.
   */
  async refreshToken(): Promise<{ refreshed: boolean; error: string | null }> {
    const accessToken = await this.token();
    if (!accessToken) return { refreshed: false, error: 'No access token saved.' };

    try {
      const res = await fetch(
        `${GRAPH_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(accessToken)}`,
      );
      const body = (await res.json().catch(() => null)) as {
        access_token?: string;
        error?: { message?: string };
      } | null;

      if (!res.ok || !body?.access_token) {
        return { refreshed: false, error: body?.error?.message ?? `Instagram returned ${res.status}` };
      }

      await this.prisma.systemSetting.upsert({
        where: { key: 'instagramAccessToken' },
        create: { key: 'instagramAccessToken', value: body.access_token },
        update: { value: body.access_token },
      });
      this.cache = null;
      this.lastError = null;
      return { refreshed: true, error: null };
    } catch (err) {
      return { refreshed: false, error: err instanceof Error ? err.message : 'Request failed' };
    }
  }
}
