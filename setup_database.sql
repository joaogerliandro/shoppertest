CREATE ROLE "user" WITH
    LOGIN
    SUPERUSER
    CREATEDB
    CREATEROLE
    INHERIT
    NOREPLICATION
    BYPASSRLS
    CONNECTION LIMIT -1
    PASSWORD 'user';

CREATE DATABASE main
    WITH
    OWNER = postgres
    ENCODING = 'UTF8'
    LOCALE_PROVIDER = 'libc'
    CONNECTION LIMIT = -1
    IS_TEMPLATE = False;

\c main;

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

ALTER TABLE IF EXISTS public."Measurement"
    OWNER to "user";