import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from './db';
import { emailQueue } from './queue';
import './worker'; // Import to start the worker

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) return res.status(400).json({ error: 'Invalid Google token' });

    let user = await prisma.user.findUnique({ where: { email: payload.email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: payload.email,
          name: payload.name,
          avatar: payload.picture,
        },
      });
    }

    res.json({ user });
  } catch (error) {
    console.error('Google Auth Error:', error);
    // Fallback for development if CLIENT_ID is not configured
    if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'your_google_client_id_here') {
      let user = await prisma.user.findFirst();
      if (!user) {
        user = await prisma.user.create({
          data: { email: 'dev@reachinbox.ai', name: 'Dev User', avatar: '' }
        });
      }
      return res.json({ user });
    }
    res.status(401).json({ error: 'Authentication failed' });
  }
});

app.post('/api/campaigns', async (req, res) => {
  const { userId, subject, body, startTime, delaySeconds, hourlyLimit, emails } = req.body;

  if (!userId || !subject || !body || !emails || !emails.length) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const campaign = await prisma.emailCampaign.create({
      data: {
        userId,
        subject,
        body,
        startTime: new Date(startTime),
        delaySeconds,
        hourlyLimit,
      }
    });

    // Create DB Jobs
    const jobsData = emails.map((email: string) => ({
      campaignId: campaign.id,
      recipientEmail: email,
      scheduledAt: new Date(startTime),
      status: 'PENDING' as const,
    }));
    
    await prisma.emailJob.createMany({ data: jobsData });

    // Fetch the inserted jobs to get their generated IDs
    const createdJobs = await prisma.emailJob.findMany({
      where: { campaignId: campaign.id }
    });

    // Push to BullMQ queue
    const bullJobs = createdJobs.map(job => {
      const delay = Math.max(0, new Date(startTime).getTime() - Date.now());
      return {
        name: 'send-email',
        data: {
          jobId: job.id,
          email: job.recipientEmail,
          subject: campaign.subject,
          body: campaign.body,
          senderId: userId, // for rate limiting
        },
        opts: {
          delay,
          jobId: job.id, // BullMQ idempotency key
        }
      };
    });

    await emailQueue.addBulk(bullJobs);

    res.json({ message: 'Campaign scheduled successfully', campaignId: campaign.id });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Failed to schedule campaign' });
  }
});

app.get('/api/jobs', async (req, res) => {
  const { userId, status } = req.query;
  try {
    const whereClause: any = {
      campaign: {
        userId: String(userId)
      }
    };
    if (status) {
      whereClause.status = status;
    }

    const jobs = await prisma.emailJob.findMany({
      where: whereClause,
      include: {
        campaign: { select: { subject: true } }
      },
      orderBy: { scheduledAt: 'asc' }
    });

    res.json(jobs);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
