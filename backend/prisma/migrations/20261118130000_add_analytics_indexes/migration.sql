CREATE INDEX "Submission_userId_languageId_idx" ON "Submission"("userId", "languageId");

CREATE INDEX "SubmissionResult_status_createdAt_idx" ON "SubmissionResult"("status", "createdAt");
