# ReachInbox Full-Stack Email Job Scheduler 🚀

A production-grade email scheduler service and dashboard, mimicking the core capabilities of ReachInbox. This project schedules emails via API, stores them in a relational database, processes them using BullMQ, and sends them via Ethereal SMTP with proper concurrency and rate limiting.

## 🎯 Architecture Overview

### How Scheduling Works
1. When a user uploads a CSV of leads via the Next.js frontend, it is parsed and submitted to the Express backend (`/api/campaigns`).
2. The backend creates an `EmailCampaign` and individual `EmailJob` records in PostgreSQL.
3. The backend then adds jobs to a **BullMQ** queue with a `delay` calculated based on the requested start time.
4. The BullMQ worker processes jobs as they become ready, applying delays and rate limits before sending them via Ethereal SMTP.

### Persistence on Restart
This system is highly resilient and handles server restarts gracefully:
- **No In-Memory Timers:** Scheduling relies entirely on BullMQ delayed jobs backed by **Redis**. 
- **DB State:** Jobs are securely saved in PostgreSQL before being queued.
- When the Node.js process is restarted, the BullMQ worker automatically connects to Redis, fetches pending or delayed jobs, and resumes processing exactly where it left off.
- **Idempotency:** A unique `jobId` ensures jobs aren't accidentally processed twice. We also verify the job's status in the DB before sending.

### Rate Limiting & Concurrency
- **Concurrency:** The BullMQ Worker is initialized with a specific `concurrency` option, allowing safe parallel processing (default 5).
- **Minimum Delay:** Inside the worker logic, an artificial `sleep()` creates a delay between processing each email to mimic real-world provider throttling.
- **Rate Limiting (Per-Sender):**
  - We use atomic **Redis Counters** (`INCR`) keyed by `senderId` and `current_hour`.
  - When the count exceeds `MAX_EMAILS_PER_HOUR`, the worker calculates the time remaining until the next hour and calls `job.moveToDelayed()` to reschedule the job. This ensures emails are never permanently dropped and maintains FIFO ordering as much as possible.

## 📋 Features Implemented

**Backend:**
- ✅ Prisma + PostgreSQL integration
- ✅ BullMQ integration with Redis for delayed processing
- ✅ Ethereal SMTP integration
- ✅ Idempotency checks to prevent duplicate sends
- ✅ Concurrency control
- ✅ Per-Sender Hourly Rate Limiting + Graceful Job Rescheduling
- ✅ Express API Endpoints for Auth, Scheduling, and Fetching Jobs

**Frontend:**
- ✅ Google OAuth Login using `@react-oauth/google`
- ✅ Modern, beautiful Dashboard UI with Tailwind CSS
- ✅ "Compose" page with drag-and-drop CSV parsing (`papaparse`)
- ✅ Tables for Scheduled and Sent emails with dynamic loading/empty states
- ✅ Fallback "Dev Mode Login" for easy testing without Google Client ID

## 🚀 How to Run

### 1. Requirements
- Docker Desktop (Required for DB and Redis)
- Node.js v18+

### 2. Infrastructure (DB + Redis)
Start the PostgreSQL and Redis containers using Docker Compose:
```bash
docker-compose up -d
```

### 3. Backend Setup
```bash
cd backend
npm install
```

**Set up Environment Variables:**
Create a `.env` in the `backend/` folder (or use the one already created):
```env
PORT=3001
DATABASE_URL="postgresql://user:password@localhost:5432/reachinbox?schema=public"
REDIS_HOST="localhost"
REDIS_PORT=6379

# Create an account at Ethereal.email and put credentials here:
SMTP_HOST="smtp.ethereal.email"
SMTP_PORT=587
SMTP_USER="your_ethereal_user"
SMTP_PASS="your_ethereal_pass"

# Set concurrency / limits
WORKER_CONCURRENCY=5
MIN_DELAY_MS=2000
MAX_EMAILS_PER_HOUR=200
```

**Run Migrations & Start Server:**
```bash
npx prisma db push
npm run dev
```

### 4. Frontend Setup
```bash
cd frontend
npm install
```

**Set up Environment Variables:**
Create a `.env.local` in the `frontend/` folder:
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id_here
```

**Start the App:**
```bash
npm run dev
```

## 🎥 Demo Scenario
1. Go to `http://localhost:3000`.
2. Login with Google (or use Dev Mode login).
3. Go to Compose. Upload a test CSV with emails.
4. Set a start time for 1 minute from now, and a rate limit of 2 emails per hour.
5. Watch the `Scheduled Emails` tab. After 1 minute, the backend worker will process 2 emails (move to `Sent` tab) and automatically delay the remaining emails to the next hour.
6. Stop the backend server mid-processing, wait 5 seconds, and restart it. Observe that no jobs are lost and scheduling resumes correctly!
