import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir, writeFile } from "node:fs/promises";

// Offline PostgreSQL introspection of versioned migrations, not remote data.
// No credentials, Docker, network access, or extra dependency is needed.
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create publication supabase_realtime;`);
  for (const name of (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
  }
  const enums = (
    await db.query(`select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
    from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace
    where n.nspname='public' group by t.typname order by t.typname`)
  ).rows;
  function tsType(type) {
    if (type.endsWith("[]")) return `(${tsType(type.slice(0, -2))})[]`;
    const enumName = type.replace(/^public\./, "");
    if (enums.some((item) => item.typname === enumName))
      return `Database["public"]["Enums"][${JSON.stringify(enumName)}]`;
    if (type === "void") return "undefined";
    if (type === "jsonb" || type === "json") return "Json";
    if (type === "boolean") return "boolean";
    if (
      [
        "integer",
        "bigint",
        "smallint",
        "numeric",
        "double precision",
        "real",
      ].includes(type)
    )
      return "number";
    if (["uuid", "text", "timestamp with time zone"].includes(type))
      return "string";
    throw new Error(`Unmapped PostgreSQL type: ${type}`);
  }
  const tables = (
    await db.query(
      "select tablename from pg_tables where schemaname='public' order by tablename",
    )
  ).rows;
  let output =
    "// Generated from versioned migrations by npm run db:types. Do not edit.\n";
  output +=
    "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];\n";
  output += "export type Database = { public: { Tables: {\n";
  for (const { tablename } of tables) {
    const columns = (
      await db.query(
        `select a.attname as name, format_type(a.atttypid,a.atttypmod) as type,
      a.attnotnull as required, d.oid is not null as has_default, a.attgenerated <> '' as generated
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=$1::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`,
        [`public.${tablename}`],
      )
    ).rows;
    output += `${JSON.stringify(tablename)}: {\n`;
    for (const shape of ["Row", "Insert", "Update"]) {
      output += `${shape}: {\n`;
      for (const column of columns) {
        const optional =
          shape === "Update" ||
          (shape === "Insert" &&
            (!column.required || column.has_default || column.generated));
        const type =
          column.generated && shape !== "Row"
            ? "never"
            : tsType(column.type) + (column.required ? "" : " | null");
        output += `${JSON.stringify(column.name)}${optional ? "?" : ""}: ${type};\n`;
      }
      output += "};\n";
    }
    const relationships = (
      await db.query(
        `select con.conname, ref.relname as reference,
      array(select attname from unnest(con.conkey) with ordinality k(key,ord) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.key order by ord) as columns,
      array(select attname from unnest(con.confkey) with ordinality k(key,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.key order by ord) as references
      from pg_constraint con join pg_class ref on ref.oid=con.confrelid join pg_namespace n on n.oid=ref.relnamespace
      where con.contype='f' and con.conrelid=$1::regclass and n.nspname='public' order by con.conname`,
        [`public.${tablename}`],
      )
    ).rows;
    output += `Relationships: [${relationships.map((row) => `{foreignKeyName:${JSON.stringify(row.conname)};columns:${JSON.stringify(row.columns)};isOneToOne:false;referencedRelation:${JSON.stringify(row.reference)};referencedColumns:${JSON.stringify(row.references)}}`).join(",")}];\n};\n`;
  }
  output += "}; Views: { [_ in never]: never }; Functions: {\n";
  const functions = (
    await db.query(`select p.proname as name, format_type(p.prorettype,null) as return_type,
      p.proretset as returns_set, p.pronargs - p.pronargdefaults as required_inputs,
      coalesce(jsonb_agg(jsonb_build_object('name',p.proargnames[a.position],
        'mode',coalesce(p.proargmodes[a.position],'i'),
        'position',a.position,'type',format_type(a.type,null)) order by a.position)
        filter (where a.type is not null),'[]'::jsonb) as fields
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    left join lateral unnest(coalesce(p.proallargtypes,p.proargtypes::oid[]))
      with ordinality a(type,position) on true
    where n.nspname='public' and p.prorettype <> 'trigger'::regtype
    group by p.oid,p.proname order by p.proname`)
  ).rows;
  for (const fn of functions) {
    const fields = (mode) =>
      fn.fields
        .filter((field) => field.mode === mode)
        .map((field) => `${JSON.stringify(field.name)}${mode === "i" && field.position > fn.required_inputs ? "?" : ""}: ${tsType(field.type)}`)
        .join(";");
    const returnType = fn.fields.some((field) => field.mode === "t")
      ? `{ ${fields("t")} }[]`
      : tsType(fn.return_type) + (fn.returns_set ? "[]" : "");
    output += `${JSON.stringify(fn.name)}: { Args: { ${fields("i")} }; Returns: ${returnType} };\n`;
  }
  output += "}; Enums: {\n";
  for (const item of enums)
    output += `${JSON.stringify(item.typname)}: ${item.labels.map((label) => JSON.stringify(label)).join(" | ")};\n`;
  output += "}; CompositeTypes: { [_ in never]: never }; }; };\n";
  await writeFile("src/types/database.ts", output);
  console.log(
    `Generated database types from ${tables.length} tables and ${functions.length} RPC functions.`,
  );
} finally {
  await db.close();
}
