-- CreateTable
CREATE TABLE "memory_cache" (
    "id" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "memory_version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_response_cache" (
    "id" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "memory_version" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_response_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_cache_user_id_run_id_memory_version_idx" ON "memory_cache"("user_id", "run_id", "memory_version");

-- CreateIndex
CREATE INDEX "memory_cache_expires_at_idx" ON "memory_cache"("expires_at");

-- CreateIndex
CREATE INDEX "llm_response_cache_user_id_run_id_memory_version_cache_key_idx" ON "llm_response_cache"("user_id", "run_id", "memory_version", "cache_key");

-- CreateIndex
CREATE INDEX "llm_response_cache_expires_at_idx" ON "llm_response_cache"("expires_at");

-- AddForeignKey
ALTER TABLE "memory_cache" ADD CONSTRAINT "memory_cache_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_response_cache" ADD CONSTRAINT "llm_response_cache_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
