-- CreateTable
CREATE TABLE "memory_items" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memory_items_run_id_user_id_created_at_idx" ON "memory_items"("run_id", "user_id", "created_at");

-- AddForeignKey
ALTER TABLE "memory_items" ADD CONSTRAINT "memory_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
