-- A request of an auditor the guard refuses, for a right he does not hold, stands in
-- the log of accesses as well (#537, section 7 of the concept: "jede seiner Anfragen").
-- Every line written before is one that was served.
ALTER TABLE "auditor_reads" ADD COLUMN "refused" boolean DEFAULT false NOT NULL;
