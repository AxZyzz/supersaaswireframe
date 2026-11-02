-- CAN-SPAM: commercial email must carry the sender's valid physical postal
-- address. Shown in every campaign email footer.
ALTER TABLE "orgs" ADD COLUMN "postal_address" text;
