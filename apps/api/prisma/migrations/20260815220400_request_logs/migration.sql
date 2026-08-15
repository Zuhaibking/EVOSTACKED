-- CreateTable
CREATE TABLE "request_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "run_id" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "request_logs_user_id_created_at_idx" ON "request_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "request_logs_run_id_created_at_idx" ON "request_logs"("run_id", "created_at");

-- AddForeignKey
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
