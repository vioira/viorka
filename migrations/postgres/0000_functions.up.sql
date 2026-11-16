-- Text JSON preserves the exact signed/encrypted application representation.
-- These overloads implement the JSON operations shared with SQLite.
CREATE FUNCTION json_valid(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT value IS JSON $$;
CREATE FUNCTION json_type(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT jsonb_typeof(value::jsonb) $$;
CREATE FUNCTION json_array_length(value text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN jsonb_typeof(value::jsonb)='array' THEN jsonb_array_length(value::jsonb) ELSE 0 END
$$;
CREATE FUNCTION json_extract(value text, path text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE result WHEN 'true'::jsonb THEN '1' WHEN 'false'::jsonb THEN '0' ELSE result #>> '{}' END
 FROM (SELECT jsonb_path_query_first(value::jsonb, path::jsonpath) AS result) extracted
$$;
CREATE FUNCTION json_each(value text, path text DEFAULT '$') RETURNS TABLE(value text)
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT item #>> '{}' FROM jsonb_path_query($1::jsonb, ($2 || '[*]')::jsonpath) AS item
 WHERE item <> 'null'::jsonb
$$;
CREATE FUNCTION json_set(value text, path text, replacement text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT jsonb_set(value::jsonb, string_to_array(substr(path,3),'.'), to_jsonb(replacement))::text
$$;
CREATE FUNCTION max(a bigint, b bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT greatest(a,b) $$;
