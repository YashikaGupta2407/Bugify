-- AlterTable
ALTER TABLE "SubmissionResult" ADD COLUMN     "compileOutput" TEXT,
ADD COLUMN     "memory" DOUBLE PRECISION,
ADD COLUMN     "stderr" TEXT,
ALTER COLUMN "executionTime" DROP NOT NULL,
ALTER COLUMN "executionTime" SET DATA TYPE DOUBLE PRECISION;
