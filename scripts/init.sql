CREATE TABLE IF NOT EXISTS public."Measurement"
(
    uuid text PRIMARY KEY COLLATE pg_catalog."default",
    value bigint,
    datetime date,
    type text COLLATE pg_catalog."default",
    confirmed boolean,
    customer_code text COLLATE pg_catalog."default",
    url text COLLATE pg_catalog."default"
)
TABLESPACE pg_default;