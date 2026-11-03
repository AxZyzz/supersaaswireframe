import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat configs (no FlatCompat needed).
const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Compiler advisory (react-hooks v7): flags our fetch-on-mount
      // effects. Kept visible as a warning until data loading moves to a
      // fetching hook; every other compiler rule stays an error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
