-- CreateTable
CREATE TABLE "ExtensionDebugSession" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "workspaceName" TEXT,
    "filePath" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "diagnosticCode" TEXT,
    "diagnosticSource" TEXT,
    "line" INTEGER,
    "severity" TEXT,
    "analysisSource" TEXT NOT NULL,
    "aiExplanation" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtensionDebugSession_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ExtensionDebugSession" ADD CONSTRAINT "ExtensionDebugSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
