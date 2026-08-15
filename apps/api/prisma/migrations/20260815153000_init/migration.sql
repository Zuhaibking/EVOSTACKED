-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "memoryVersion" INTEGER NOT NULL DEFAULT 0,
    "selectedCandidate" TEXT,
    "hasTournament" BOOLEAN NOT NULL DEFAULT false,
    "activeVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fragment" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "candidateId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fragment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBrain" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBrain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionSnapshot" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VersionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "memoryVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmResponseCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "memoryVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmResponseCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "runId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectBrain_runId_key" ON "ProjectBrain"("runId");
CREATE UNIQUE INDEX "VersionSnapshot_runId_version_key" ON "VersionSnapshot"("runId", "version");
CREATE INDEX "Run_userId_idx" ON "Run"("userId");
CREATE INDEX "Message_runId_userId_createdAt_idx" ON "Message"("runId", "userId", "createdAt");
CREATE INDEX "Fragment_runId_userId_idx" ON "Fragment"("runId", "userId");
CREATE INDEX "Candidate_runId_userId_idx" ON "Candidate"("runId", "userId");
CREATE INDEX "VersionSnapshot_runId_userId_idx" ON "VersionSnapshot"("runId", "userId");
CREATE INDEX "MemoryItem_runId_userId_createdAt_idx" ON "MemoryItem"("runId", "userId", "createdAt");
CREATE INDEX "MemoryCache_userId_runId_memoryVersion_idx" ON "MemoryCache"("userId", "runId", "memoryVersion");
CREATE INDEX "MemoryCache_expiresAt_idx" ON "MemoryCache"("expiresAt");
CREATE INDEX "LlmResponseCache_userId_runId_memoryVersion_cacheKey_idx" ON "LlmResponseCache"("userId", "runId", "memoryVersion", "cacheKey");
CREATE INDEX "LlmResponseCache_expiresAt_idx" ON "LlmResponseCache"("expiresAt");
CREATE INDEX "RequestLog_userId_createdAt_idx" ON "RequestLog"("userId", "createdAt");
CREATE INDEX "RequestLog_runId_createdAt_idx" ON "RequestLog"("runId", "createdAt");

ALTER TABLE "Run" ADD CONSTRAINT "Run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Fragment" ADD CONSTRAINT "Fragment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectBrain" ADD CONSTRAINT "ProjectBrain_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VersionSnapshot" ADD CONSTRAINT "VersionSnapshot_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryItem" ADD CONSTRAINT "MemoryItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryCache" ADD CONSTRAINT "MemoryCache_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LlmResponseCache" ADD CONSTRAINT "LlmResponseCache_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequestLog" ADD CONSTRAINT "RequestLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
