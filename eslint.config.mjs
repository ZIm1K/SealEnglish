import next from "eslint-config-next";

export default [
  ...next,
  { ignores: [".next/**", "out/**", "node_modules/**", "supabase/functions/**", "design/**"] },
];
