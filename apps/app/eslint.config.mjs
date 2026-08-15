import nextVitals from 'eslint-config-next/core-web-vitals'

const nextConfig = Array.isArray(nextVitals)
  ? nextVitals
  : nextVitals?.default || nextVitals

const eslintConfig = [
  ...nextConfig,
  {
    rules: {
      // Pre-existing app patterns; React 19 compiler plugin is stricter than this pass.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
    },
  },
]

export default eslintConfig
