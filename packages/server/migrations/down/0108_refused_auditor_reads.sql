-- Takes back 0108_refused_auditor_reads: the log no longer tells a refused request from one served.
ALTER TABLE "auditor_reads" DROP COLUMN "refused";
