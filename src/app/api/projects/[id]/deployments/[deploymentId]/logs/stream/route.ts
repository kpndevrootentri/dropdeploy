import { NextRequest } from 'next/server';
import { getSession } from '@/lib/get-session';
import { deploymentService } from '@/services/deployment';
import { createRedisConnection } from '@/lib/redis';

const TERMINAL_STATUSES = new Set(['DEPLOYED', 'FAILED', 'CANCELLED']);

/**
 * GET /api/projects/:id/deployments/:deploymentId/logs/stream
 * SSE endpoint for streaming build logs in real-time.
 * - For terminal deployments: sends existing log then closes.
 * - For active deployments: subscribes to Redis pub/sub and streams lines.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; deploymentId: string }> }
): Promise<Response> {
  try {
    const session = await getSession(req);
    const { deploymentId } = await params;

    const deployment = await deploymentService.getById(deploymentId, session.userId);

    const encoder = new TextEncoder();

    const sendEvent = (type: string, data: unknown): Uint8Array => {
      return encoder.encode(`data: ${JSON.stringify({ type, ...( typeof data === 'object' && data !== null ? data : { value: data }) })}\n\n`);
    };

    if (TERMINAL_STATUSES.has(deployment.status)) {
      // Deployment is done — send full log and close immediately
      const stream = new ReadableStream({
        start(controller) {
          if (deployment.buildLog) {
            controller.enqueue(sendEvent('existing', { log: deployment.buildLog }));
          }
          controller.enqueue(sendEvent('done', {}));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // Deployment is active — subscribe to Redis for live lines
    const redisChannel = `build:${deploymentId}`;

    const stream = new ReadableStream({
      async start(controller) {
        // Send any partial log already stored
        if (deployment.buildLog) {
          controller.enqueue(sendEvent('existing', { log: deployment.buildLog }));
        }

        const subscriber = createRedisConnection();

        const cleanup = (): void => {
          subscriber.quit().catch(() => {});
        };

        req.signal.addEventListener('abort', () => {
          cleanup();
          try { controller.close(); } catch { /* already closed */ }
        });

        subscriber.on('message', (channel, message) => {
          if (channel !== redisChannel) return;
          if (message === '__DONE__') {
            controller.enqueue(sendEvent('done', {}));
            cleanup();
            try { controller.close(); } catch { /* already closed */ }
            return;
          }
          try {
            controller.enqueue(sendEvent('line', { text: message }));
          } catch {
            cleanup();
          }
        });

        subscriber.on('error', () => {
          try { controller.close(); } catch { /* already closed */ }
        });

        await subscriber.subscribe(redisChannel);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch {
    return new Response('Unauthorized', { status: 401 });
  }
}
