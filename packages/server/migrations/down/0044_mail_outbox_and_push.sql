-- Rolling the mail outbox and push back to how 0043 left the database.
--
-- What it costs an installation that runs it: every message by mail, sent or
-- waiting, every device that takes push messages, every occasion somebody
-- switched off and every push message. The browsers keep their subscriptions
-- and get nothing more; switched on again after an update, they are asked
-- once more. The mail server of an operator stays, it has been a table since
-- 0005. Dropping a table writes nothing in any log.

DROP TABLE "push_outbox";--> statement-breakpoint
DROP TABLE "push_opt_outs";--> statement-breakpoint
DROP TABLE "push_subscriptions";--> statement-breakpoint
DROP TABLE "mail_outbox";--> statement-breakpoint
DROP TYPE "push_status";--> statement-breakpoint
DROP TYPE "push_kind";--> statement-breakpoint
DROP TYPE "push_entry";--> statement-breakpoint
DROP TYPE "mail_status";--> statement-breakpoint
DROP TYPE "mail_kind";
