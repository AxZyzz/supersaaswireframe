CREATE OR REPLACE FUNCTION `${PROJECT}.${LEARN}.safe_company_key`(k STRING)
RETURNS STRING
OPTIONS (description = "Company key made safe for analytics. A free-mail lead has the key email:<address>, which is an email address: it becomes email:<16 hex of its SHA-256> so the same company still groups together but no address is readable. Website-domain keys pass through unchanged.")
AS (
  IF(STARTS_WITH(k, 'email:'), CONCAT('email:', SUBSTR(TO_HEX(SHA256(k)), 1, 16)), k)
);
