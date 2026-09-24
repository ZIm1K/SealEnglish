import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "out/**", "node_modules/**", "supabase/functions/**", "design/**", "src/components/mascot/seal-geometry.ts"] },
];

export default config;
