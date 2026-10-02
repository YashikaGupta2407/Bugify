-- CreateTable
CREATE TABLE "DebuggingExplanation" (
    "id" SERIAL NOT NULL,
    "submissionResultId" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "location" TEXT,
    "explanation" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "correctedCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebuggingExplanation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DebuggingExplanation_submissionResultId_key" ON "DebuggingExplanation"("submissionResultId");

-- AddForeignKey
ALTER TABLE "DebuggingExplanation" ADD CONSTRAINT "DebuggingExplanation_submissionResultId_fkey" FOREIGN KEY ("submissionResultId") REFERENCES "SubmissionResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
