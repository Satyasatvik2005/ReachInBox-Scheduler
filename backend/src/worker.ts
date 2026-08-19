import { Worker, Job } from 'bullmq';
import { getRedisClient } from './queue';
import { sendEmail } from './mailer';
import { prisma } from './db';

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
const MIN_DELAY_MS = parseInt(process.env.MIN_DELAY_MS || '2000', 10);
const MAX_EMAILS_PER_HOUR = parseInt(process.env.MAX_EMAILS_PER_HOUR || '200', 10);

const redis = getRedisClient();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const emailWorker = new Worker(
  'email-queue',
  async (job: Job) => {
    const { jobId, email, subject, body, senderId } = job.data;

    // 1. Check idempotency (is it already sent?)
    const dbJob = await prisma.emailJob.findUnique({ where: { id: jobId } });
    if (!dbJob || dbJob.status === 'SENT') {
      console.log(`Job ${jobId} already sent or not found. Skipping.`);
      return;
    }

    // 2. Rate Limiting (Per sender per hour)
    const currentHour = new Date().toISOString().slice(0, 13); // e.g., "2026-08-20T00"
    const rateLimitKey = `ratelimit:${senderId}:${currentHour}`;
    
    // Atomically increment counter
    const currentCount = await redis.incr(rateLimitKey);
    if (currentCount === 1) {
      await redis.expire(rateLimitKey, 3600); // expire in 1 hour
    }

    if (currentCount > MAX_EMAILS_PER_HOUR) {
      console.log(`Rate limit exceeded for sender ${senderId}. Delaying job ${jobId} to next hour.`);
      // Calculate ms until next hour
      const now = new Date();
      const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
      const delayMs = nextHour.getTime() - now.getTime();
      
      // We must throw an error or handle it via moveToDelayed. Since we want to preserve order, we use moveToDelayed.
      await job.moveToDelayed(Date.now() + delayMs, job.token);
      // Decrement the counter since we didn't actually send it
      await redis.decr(rateLimitKey);
      throw new Error('Rate limit exceeded. Job delayed.'); // Throwing stops current execution
    }

    // 3. Minimum Delay between emails (Throttling)
    await sleep(MIN_DELAY_MS);

    // 4. Send Email
    try {
      await sendEmail(email, subject, body);
      
      // Update DB
      await prisma.emailJob.update({
        where: { id: jobId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
        },
      });
      console.log(`Successfully sent email for job ${jobId}`);
    } catch (error: any) {
      console.error(`Failed to send email for job ${jobId}:`, error);
      await prisma.emailJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          error: error.message,
        },
      });
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: CONCURRENCY,
  }
);

emailWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed.`);
});

emailWorker.on('failed', (job, err) => {
  console.log(`Job ${job?.id} failed with error ${err.message}`);
});
